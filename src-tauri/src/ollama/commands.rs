//! Core Tauri commands: chat, abort, and health check.
//!
//! These are the primary interactive commands used by the frontend during
//! an active chat session or when probing server status.

use crate::payloads::{ApiResponse, ChatMessage, ChatOptions, OllamaHealth};
use crate::validation::{is_valid_request_id, validation_error};
use log;
use std::time::Instant;
use tauri::{AppHandle, Runtime};

use super::client::ABORT_HANDLES;
use super::client::REQUEST_CACHE;
use super::service::OllamaChatService;

// Service instance (could be made injectable if needed)
static OLLAMA_SERVICE: OllamaChatService = OllamaChatService;

// ==================== CHAT ====================

#[tauri::command]
pub async fn cmd_ollama_chat<R: Runtime>(
    app: AppHandle<R>,
    base_url: String,
    model: String,
    messages: Vec<ChatMessage>,
    options: ChatOptions,
    request_id: String,
) -> ApiResponse<bool> {
    match OLLAMA_SERVICE
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
    log::info!("Aborting chat request: {}", request_id);

    if !is_valid_request_id(&request_id) {
        return validation_error(
            "INVALID_INPUT",
            format!("Invalid request_id: {:?}", request_id),
        );
    }

    if let Some((_, token)) = ABORT_HANDLES.remove(&request_id) {
        token.cancel();
        log::info!("Chat request {} cancelled successfully", request_id);
    } else {
        log::warn!("No active chat found for request_id: {}", request_id);
    }

    REQUEST_CACHE.remove(&request_id);

    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

// ==================== HEALTH CHECK ====================

#[tauri::command]
pub async fn cmd_ollama_check_health(base_url: String) -> ApiResponse<OllamaHealth> {
    let start = Instant::now();
    match OLLAMA_SERVICE.health_check(base_url).await {
        Ok(health) => ApiResponse {
            success: true,
            data: Some(health),
            error: None,
        },
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            ApiResponse {
                success: false,
                data: Some(OllamaHealth {
                    is_running: false,
                    version: None,
                    response_time_ms: elapsed,
                }),
                error: Some(e),
            }
        }
    }
}
