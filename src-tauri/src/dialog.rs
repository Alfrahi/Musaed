use crate::payloads::ApiResponse;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

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
    // Map kind to dialog type - default to confirm for boolean response
    let dialog_kind = kind.as_deref().unwrap_or("confirm");

    let confirmed = match dialog_kind {
        "alert" | "info" | "warning" | "error" => {
            // For non-confirmation dialogs, show alert and return true (acknowledged)
            app.dialog()
                .message(message)
                .title(title)
                .kind(to_dialog_kind(dialog_kind))
                .blocking_show();
            true
        }
        _ => {
            // For confirm dialogs, use Info kind (no Question variant exists)
            // and return user's choice
            app.dialog()
                .message(message)
                .title(title)
                .kind(tauri_plugin_dialog::MessageDialogKind::Info)
                .blocking_show()
        }
    };

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
