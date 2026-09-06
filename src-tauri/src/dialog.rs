use crate::fs::FsAccessGrants;
use crate::payloads::ApiResponse;
use serde::Deserialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

/// Dialog kinds accepted by `cmd_dialog_ask`. Serde deserialization rejects
/// unknown kinds at the IPC boundary — no silent coercion to a default kind
/// (an "error" dialog must never silently degrade into an "info" dialog).
///
/// Mirrors `DialogKindSchema` in `packages/contracts/src/schemas/dialog.ts`.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DialogKind {
    Info,
    Warning,
    Error,
    Confirm,
}

impl DialogKind {
    fn to_message_kind(self) -> tauri_plugin_dialog::MessageDialogKind {
        match self {
            DialogKind::Info | DialogKind::Confirm => tauri_plugin_dialog::MessageDialogKind::Info,
            DialogKind::Warning => tauri_plugin_dialog::MessageDialogKind::Warning,
            DialogKind::Error => tauri_plugin_dialog::MessageDialogKind::Error,
        }
    }
}

/// Shows a native confirmation dialog to the user and returns their response.
///
/// # Arguments
/// * `app` - Tauri app handle for accessing the dialog plugin
/// * `title` - The dialog title
/// * `message` - The dialog message
/// * `kind` - Optional dialog kind (info|warning|error|confirm)
///
/// # Returns
/// `ApiResponse<bool>` - true if user confirmed, false if cancelled
#[tauri::command]
pub async fn cmd_dialog_ask(
    app: AppHandle,
    title: String,
    message: String,
    kind: Option<DialogKind>,
) -> ApiResponse<bool> {
    let dialog_kind = kind.unwrap_or(DialogKind::Confirm);

    let confirmed = app
        .dialog()
        .message(message)
        .title(title)
        .kind(dialog_kind.to_message_kind())
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show();

    ApiResponse {
        success: true,
        data: Some(confirmed),
        error: None,
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
    fn test_dialog_kind_deserializes_known_kinds() {
        assert_eq!(
            serde_json::from_str::<DialogKind>("\"info\"").unwrap(),
            DialogKind::Info
        );
        assert_eq!(
            serde_json::from_str::<DialogKind>("\"warning\"").unwrap(),
            DialogKind::Warning
        );
        assert_eq!(
            serde_json::from_str::<DialogKind>("\"error\"").unwrap(),
            DialogKind::Error
        );
        assert_eq!(
            serde_json::from_str::<DialogKind>("\"confirm\"").unwrap(),
            DialogKind::Confirm
        );
    }

    #[test]
    fn test_dialog_kind_rejects_unknown_kinds() {
        // Unknown kinds must fail deserialization — no coercion to Info.
        assert!(serde_json::from_str::<DialogKind>("\"alert\"").is_err());
        assert!(serde_json::from_str::<DialogKind>("\"unknown\"").is_err());
        assert!(serde_json::from_str::<DialogKind>("\"INFO\"").is_err());
        assert!(serde_json::from_str::<DialogKind>("42").is_err());
    }

    #[test]
    fn test_dialog_kind_maps_to_message_kind() {
        assert_eq!(
            DialogKind::Info.to_message_kind(),
            tauri_plugin_dialog::MessageDialogKind::Info
        );
        assert_eq!(
            DialogKind::Confirm.to_message_kind(),
            tauri_plugin_dialog::MessageDialogKind::Info
        );
        assert_eq!(
            DialogKind::Warning.to_message_kind(),
            tauri_plugin_dialog::MessageDialogKind::Warning
        );
        assert_eq!(
            DialogKind::Error.to_message_kind(),
            tauri_plugin_dialog::MessageDialogKind::Error
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
