use crate::error_codes;
use crate::payloads::ApiResponse;
use crate::payloads::BackendError;
use std::fs;
use std::path::Path;

/// Exports a conversation to Markdown format.
///
/// # Arguments
/// * `conversation_id` - The conversation ID to export
/// * `path` - The file path to save to
///
/// # Returns
/// `ApiResponse<bool>` - true if export succeeded, false otherwise
#[tauri::command]
pub async fn cmd_export_markdown(conversation_id: String, path: String) -> ApiResponse<bool> {
    // For now, implement a simple version that just creates an empty file
    // In a real implementation, this would fetch the conversation from storage
    // and convert it to markdown format

    // Create a simple markdown content
    let markdown_content = format!(
        "# Exported Conversation: {}\n\nThis is a placeholder export for conversation {}.\n",
        conversation_id, conversation_id
    );

    // Write to file
    match fs::write(Path::new(&path), markdown_content) {
        Ok(_) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::FILE_SYSTEM_ERROR,
                format!("Failed to write export file: {}", e),
            )),
        },
    }
}
