//! Core Tauri commands: chat, abort, and health check.
//!
//! These are the primary interactive commands used by the frontend during
//! an active chat session or when probing server status.

use crate::payloads::{ApiResponse, ChatMessage, ChatOptions, OllamaHealth};
use tauri::{AppHandle, Runtime};

use super::service::{OllamaChatRequest, OllamaChatService};

// ==================== CHAT ====================

#[tauri::command]
pub async fn cmd_ollama_chat<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    base_url: String,
    model: String,
    messages: Vec<ChatMessage>,
    options: ChatOptions,
    request_id: String,
) -> ApiResponse<bool> {
    // Rate limit enforced once in OllamaChatService::chat; checking here too
    // would consume two slots per request against the quota.
    let service = OllamaChatService;
    crate::metrics::begin_chat(&request_id);
    let metrics_request_id = request_id.clone();
    let req = OllamaChatRequest {
        app,
        window_label: window.label().to_string(),
        base_url,
        model,
        messages,
        options,
        request_id,
    };
    match service.chat(req).await {
        Ok(()) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Err(e) => {
            crate::metrics::abandon_chat(&metrics_request_id);
            ApiResponse {
                success: false,
                data: None,
                error: Some(e),
            }
        }
    }
}

// ==================== ABORT CHAT ====================

#[tauri::command]
pub async fn cmd_ollama_abort_chat(request_id: String) -> ApiResponse<()> {
    crate::ollama::abort_service::abort_chat(request_id).await
}

// ==================== HEALTH CHECK ====================

#[tauri::command]
pub async fn cmd_ollama_check_health(base_url: String) -> ApiResponse<OllamaHealth> {
    crate::ollama::health_service::check_health(base_url).await
}
