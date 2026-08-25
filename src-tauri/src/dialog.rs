use crate::fs_commands::FsAccessGrants;
use crate::payloads::ApiResponse;
use serde::Deserialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

/// Shows a native confirmation dialog to the user and returns their response.
///
/// # Arguments
/// * `app` - Tauri app handle for accessing the dialog plugin
/// * `title` - The dialog title
/// * `message` - The dialog message
/// * `kind` - Optional dialog kind ("alert", "confirm", "info", "warning", "error")
///
/// # Returns
/// `ApiResponse<bool>` - true if user confirmed, false if cancelled
#[tauri::command]
pub async fn cmd_dialog_ask(
    app: AppHandle,
    title: String,
    message: String,
    kind: Option<String>,
) -> ApiResponse<bool> {
    // Map kind to dialog type — default to confirm for boolean response
    let dialog_kind = kind.as_deref().unwrap_or("confirm");

    let confirmed = app
        .dialog()
        .message(message)
        .title(title)
        .kind(to_dialog_kind(dialog_kind))
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show();

    ApiResponse {
        success: true,
        data: Some(confirmed),
        error: None,
    }
}

/// Maps string kind to tauri_plugin_dialog::MessageDialogKind
fn to_dialog_kind(kind: &str) -> tauri_plugin_dialog::MessageDialogKind {
    match kind {
        "alert" | "info" => tauri_plugin_dialog::MessageDialogKind::Info,
        "warning" => tauri_plugin_dialog::MessageDialogKind::Warning,
        "error" => tauri_plugin_dialog::MessageDialogKind::Error,
        _ => tauri_plugin_dialog::MessageDialogKind::Info,
    }
}

// ── File dialog filter ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

// ── File open dialog ──────────────────────────────────────────────────

/// Shows a native file/folder open dialog and returns the selected path(s).
///
/// # Arguments
/// * `app` - Tauri app handle
/// * `filters` - Optional file extension filters
/// * `multiple` - Whether to allow multiple selection
/// * `directory` - Whether to select directories instead of files
/// * `default_path` - Optional default path to open the dialog at
///
/// # Returns
/// `ApiResponse<Option<Vec<String>>>` — selected path(s), or None if cancelled
///
/// Selected paths are registered as filesystem access grants, authorizing
/// subsequent `cmd_fs_*` calls against them (STANDARDS §16).
#[tauri::command]
pub async fn cmd_dialog_open_file(
    app: AppHandle,
    grants: State<'_, FsAccessGrants>,
    filters: Option<Vec<FileFilter>>,
    multiple: Option<bool>,
    directory: Option<bool>,
    default_path: Option<String>,
) -> Result<ApiResponse<Option<Vec<String>>>, String> {
    let mut builder = app.dialog().file();

    if let Some(f) = filters {
        for ff in &f {
            let exts: Vec<&str> = ff.extensions.iter().map(|s| s.as_str()).collect();
            builder = builder.add_filter(&ff.name, &exts);
        }
    }

    if let Some(path) = default_path {
        builder = builder.set_directory(path);
    }

    let is_multi = multiple.unwrap_or(false);
    let is_dir = directory.unwrap_or(false);

    let result: Option<Vec<String>> = if is_dir {
        if is_multi {
            builder.blocking_pick_folders().map(|paths| {
                paths
                    .iter()
                    .filter_map(|p| p.as_path().map(|pb| pb.to_string_lossy().to_string()))
                    .collect()
            })
        } else {
            builder
                .blocking_pick_folder()
                .and_then(|p| p.as_path().map(|pb| vec![pb.to_string_lossy().to_string()]))
        }
    } else {
        if is_multi {
            builder.blocking_pick_files().map(|paths| {
                paths
                    .iter()
                    .filter_map(|p| p.as_path().map(|pb| pb.to_string_lossy().to_string()))
                    .collect()
            })
        } else {
            builder
                .blocking_pick_file()
                .and_then(|p| p.as_path().map(|pb| vec![pb.to_string_lossy().to_string()]))
        }
    };

    match result {
        Some(paths) if !paths.is_empty() => {
            grants.grant_paths(paths.iter().cloned());
            Ok(ApiResponse {
                success: true,
                data: Some(Some(paths)),
                error: None,
            })
        }
        _ => Ok(ApiResponse {
            success: true,
            data: Some(None),
            error: None,
        }),
    }
}

// ── File save dialog ──────────────────────────────────────────────────

/// Shows a native file save dialog and returns the selected path.
///
/// # Arguments
/// * `app` - Tauri app handle
/// * `filters` - File extension filters
/// * `default_path` - Optional default filename/path
///
/// # Returns
/// `ApiResponse<Option<String>>` — the selected save path, or None if cancelled
///
/// The selected path is registered as a filesystem access grant,
/// authorizing the subsequent `cmd_fs_write_text_file` call (STANDARDS §16).
#[tauri::command]
pub async fn cmd_dialog_save_file(
    app: AppHandle,
    grants: State<'_, FsAccessGrants>,
    filters: Option<Vec<FileFilter>>,
    default_path: Option<String>,
) -> Result<ApiResponse<Option<String>>, String> {
    let mut builder = app.dialog().file();

    if let Some(f) = filters {
        for ff in &f {
            let exts: Vec<&str> = ff.extensions.iter().map(|s| s.as_str()).collect();
            builder = builder.add_filter(&ff.name, &exts);
        }
    }

    if let Some(path) = default_path {
        builder = builder.set_file_name(path);
    }

    match builder.blocking_save_file() {
        Some(path) => {
            let path_str = path.as_path().map(|pb| pb.to_string_lossy().to_string());
            if let Some(selected) = &path_str {
                grants.grant_paths([selected.clone()]);
            }
            Ok(ApiResponse {
                success: true,
                data: Some(path_str),
                error: None,
            })
        }
        None => Ok(ApiResponse {
            success: true,
            data: Some(None),
            error: None,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error_codes;
    use crate::payloads::BackendError;

    #[test]
    fn test_to_dialog_kind_info() {
        assert_eq!(
            to_dialog_kind("info"),
            tauri_plugin_dialog::MessageDialogKind::Info
        );
        assert_eq!(
            to_dialog_kind("alert"),
            tauri_plugin_dialog::MessageDialogKind::Info
        );
    }

    #[test]
    fn test_to_dialog_kind_warning() {
        assert_eq!(
            to_dialog_kind("warning"),
            tauri_plugin_dialog::MessageDialogKind::Warning
        );
    }

    #[test]
    fn test_to_dialog_kind_error() {
        assert_eq!(
            to_dialog_kind("error"),
            tauri_plugin_dialog::MessageDialogKind::Error
        );
    }

    #[test]
    fn test_to_dialog_kind_default_info() {
        // Unknown or confirm types default to Info (no Question variant exists)
        assert_eq!(
            to_dialog_kind("confirm"),
            tauri_plugin_dialog::MessageDialogKind::Info
        );
        assert_eq!(
            to_dialog_kind("unknown"),
            tauri_plugin_dialog::MessageDialogKind::Info
        );
    }

    #[test]
    fn test_error_response_structure() {
        // Test error response structure
        let error_response: ApiResponse<bool> = ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::DIALOG_ERROR,
                "Test error".to_string(),
            )),
        };

        assert!(!error_response.success);
        assert!(error_response.data.is_none());
        assert!(error_response.error.is_some());
        assert_eq!(
            error_response.error.unwrap().code,
            error_codes::DIALOG_ERROR
        );
    }

    #[test]
    fn test_success_response_structure() {
        // Test success response structure for confirmed
        let success_response: ApiResponse<bool> = ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        };

        assert!(success_response.success);
        assert_eq!(success_response.data, Some(true));
        assert!(success_response.error.is_none());
    }

    #[test]
    fn test_success_response_cancelled() {
        // Test success response for cancelled (false)
        let cancelled_response: ApiResponse<bool> = ApiResponse {
            success: true,
            data: Some(false),
            error: None,
        };

        assert!(cancelled_response.success);
        assert_eq!(cancelled_response.data, Some(false));
        assert!(cancelled_response.error.is_none());
    }
}
