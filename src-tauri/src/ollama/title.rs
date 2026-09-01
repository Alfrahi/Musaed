//! Title generation Tauri command.
//!
//! Contains the thin-adapter [`cmd_ollama_generate_title`] command that
//! delegates all business logic to [`super::title_service::TitleService`].

use crate::payloads::ApiResponse;

use super::title_service::{GenerateTitleRequest, TitleService};

/// Generates a short conversation title by sending the first user message to
/// Ollama with `stream: false`. Uses a system instruction that instructs the model
/// to return only a concise title.
#[tauri::command]
pub async fn cmd_ollama_generate_title(
    window: tauri::Window,
    base_url: String,
    model: String,
    user_message: String,
    assistant_message: String,
    language: String,
) -> ApiResponse<String> {
    if let Err(e) = crate::rate_limiter::check(window.label(), "cmd_ollama_generate_title") {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        };
    }
    let service = TitleService;
    let req = GenerateTitleRequest {
        window_label: window.label().to_string(),
        base_url,
        model,
        user_message,
        assistant_message,
        language,
    };
    service.generate_title(req).await
}
