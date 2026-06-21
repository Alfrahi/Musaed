//! Core Tauri commands: chat, abort, and health check.
//!
//! These are the primary interactive commands used by the frontend during
//! an active chat session or when probing server status.

use crate::payloads::{ApiResponse, ChatMessage, ChatOptions, OllamaHealth};
use crate::rate_limiter::RATE_LIMITER;
use tauri::{AppHandle, Runtime};

use super::service::OllamaChatService;

// Service instance (could be made injectable if needed)
// The service is instantiated per call to avoid static globals.
// This keeps the command a thin adapter while allowing easy testing.
// No state is stored in the service, so creating a new instance has negligible cost.

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
    // Check rate limiting first
    if let Err(e) = RATE_LIMITER.check_rate_limit(window.label(), "cmd_ollama_chat") {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        };
    }

    // Instantiate the service locally; no shared mutable state.
    let service = OllamaChatService;
    match service
        .chat(app, base_url, model, messages, options, request_id)
        .await
    {
        Ok(()) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

// ==================== ABORT CHAT ====================

#[tauri::command]
pub async fn cmd_ollama_abort_chat(request_id: String) -> ApiResponse<()> {
    // Thin adapter – delegate to domain service
    crate::ollama::abort_service::abort_chat(request_id).await
}

// ==================== HEALTH CHECK ====================

#[tauri::command]
pub async fn cmd_ollama_check_health(base_url: String) -> ApiResponse<OllamaHealth> {
    // Thin adapter – delegate to domain service
    crate::ollama::health_service::check_health(base_url).await
}
