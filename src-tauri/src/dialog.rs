use crate::payloads::ApiResponse;
use tauri::AppHandle;

/// Shows a dialog to the user and returns their response.
///
/// # Arguments
/// * `_app` - Tauri app handle (unused in current implementation)
/// * `_title` - The dialog title (unused in current implementation)
/// * `_message` - The dialog message (unused in current implementation)  
/// * `_kind` - Optional dialog kind (unused in current implementation)
///
/// # Returns
/// `ApiResponse<bool>` - true if user confirmed, false if cancelled
#[tauri::command]
pub async fn cmd_dialog_ask(
    _app: AppHandle,
    _title: String,
    _message: String,
    _kind: Option<String>,
) -> ApiResponse<bool> {
    // For now, implement a simple version that always returns true
    // In a real implementation, this would show an actual dialog
    ApiResponse {
        success: true,
        data: Some(true),
        error: None,
    }
}
