//! Tauri commands for file selection and extraction (placeholders for future implementation).

use crate::payloads::ApiResponse;

#[tauri::command]
pub async fn select_and_extract_files() -> ApiResponse<Vec<String>> {
    log::debug!("select_and_extract_files called (placeholder)");
    ApiResponse {
        success: true,
        data: Some(vec![]),
        error: None,
    }
}

#[tauri::command]
pub async fn select_and_extract_folder() -> ApiResponse<Vec<String>> {
    log::debug!("select_and_extract_folder called (placeholder)");
    ApiResponse {
        success: true,
        data: Some(vec![]),
        error: None,
    }
}
