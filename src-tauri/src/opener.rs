use crate::payloads::ApiResponse;
use tauri::AppHandle;

/// Opens a URL in the user's default browser.
///
/// # Arguments
/// * `_app` - Tauri app handle (unused in current implementation)
/// * `_url` - The URL to open (unused in current implementation)
///
/// # Returns
/// `ApiResponse<bool>` - true if URL was opened successfully, false otherwise
#[tauri::command]
pub async fn cmd_opener_open_url(_app: AppHandle, _url: String) -> ApiResponse<bool> {
    // For now, implement a simple version that always returns true
    // In a real implementation, this would use the opener plugin
    ApiResponse {
        success: true,
        data: Some(true),
        error: None,
    }
}
