//! Core Tauri commands: chat, abort, and health check.
//!
//! These are the primary interactive commands used by the frontend during
//! an active chat session or when probing server status.

use crate::payloads::{ApiResponse, BackendError, ChatMessage, ChatOptions, OllamaHealth};
use scopeguard::defer;
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::time;
use tokio_util::sync::CancellationToken;

use super::client::{
    acquire_global_permit, invalid_ollama_base, ollama_endpoint, request_cache_try_insert,
    retry_with_backoff, ABORT_HANDLES, CONCURRENT_SEMAPHORE, EVENT_OLLAMA_ERROR, HTTP_CLIENT,
    INITIAL_REQUEST_TIMEOUT_SECS, MAX_TOTAL_IMAGE_SIZE_BYTES, REQUEST_CACHE,
    STREAM_ABSOLUTE_TIMEOUT_SECS,
};
use super::streaming::process_chat_stream;

// ==================== CHAT ====================

#[tauri::command]
pub async fn chat_with_ollama<R: Runtime>(
    app: AppHandle<R>,
    base_url: String,
    model: String,
    messages: Vec<ChatMessage>,
    options: ChatOptions,
    request_id: String,
) -> ApiResponse<bool> {
    log::info!(
        "Starting chat request: request_id={}, model={}",
        request_id,
        model
    );
    let start = std::time::Instant::now();

    // Image size safety check
    let total_b64_len: usize = messages
        .iter()
        .filter_map(|m| m.images.as_ref())
        .flatten()
        .map(|s| s.len())
        .sum();

    if total_b64_len > (MAX_TOTAL_IMAGE_SIZE_BYTES * 4 / 3 + 1024) {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                "FILE_TOO_LARGE",
                format!(
                    "Total image size exceeds {} MiB limit",
                    MAX_TOTAL_IMAGE_SIZE_BYTES / 1024 / 1024
                ),
            )),
        };
    }

    let url = match ollama_endpoint(&base_url, "api/chat") {
        Ok(u) => u,
        Err(msg) => return invalid_ollama_base(msg),
    };

    let _global_permit = match acquire_global_permit().await {
        Ok(p) => p,
        Err(msg) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new("RATE_LIMITED", msg)),
            }
        }
    };

    // Atomic duplicate check (bounded insert with LRU eviction)
    if !request_cache_try_insert(request_id.clone()) {
        log::warn!("Duplicate request detected: {}", request_id);
        return ApiResponse {
            success: false,
            data: None,
            error: Some(
                BackendError::new("DUPLICATE_REQUEST", "Request already in progress")
                    .with_request_id(request_id),
            ),
        };
    }

    let permit = match CONCURRENT_SEMAPHORE.acquire().await {
        Ok(p) => p,
        Err(_) => {
            REQUEST_CACHE.remove(&request_id);
            return ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new(
                    "RATE_LIMITED",
                    "Too many concurrent requests",
                )),
            };
        }
    };

    let cancel_token = Arc::new(CancellationToken::new());
    ABORT_HANDLES.insert(request_id.clone(), cancel_token.clone());

    let payload = json!({
        "model": model,
        "messages": messages,
        "options": options,
        "stream": true
    });

    // Initial request with timeout + retry
    let response = match retry_with_backoff(
        || {
            let url = url.clone();
            let payload = payload.clone();
            async move {
                HTTP_CLIENT
                    .post(&url)
                    .json(&payload)
                    .timeout(Duration::from_secs(INITIAL_REQUEST_TIMEOUT_SECS))
                    .send()
                    .await
            }
        },
        2,
        500,
    )
    .await
    {
        Ok(resp) => resp,
        Err(e) => {
            log::error!("Failed to send chat request: {}", e);
            ABORT_HANDLES.remove(&request_id);
            REQUEST_CACHE.remove(&request_id);
            return ApiResponse {
                success: false,
                data: None,
                error: Some(
                    BackendError::new("REQUEST_ERROR", e.to_string())
                        .with_request_id(request_id)
                        .with_context(
                            "Failed to connect to Ollama chat endpoint".to_string(),
                        )
                        .retryable(),
                ),
            };
        }
    };

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let error_text = response.text().await.unwrap_or_default();
        log::error!("Ollama returned error status {}: {}", status, error_text);

        ABORT_HANDLES.remove(&request_id);
        REQUEST_CACHE.remove(&request_id);
        return ApiResponse {
            success: false,
            data: None,
            error: Some(
                BackendError::new("OLLAMA_ERROR", error_text)
                    .with_request_id(request_id)
                    .with_context(format!("HTTP Status: {}", status)),
            ),
        };
    }

    let request_id_clone = request_id.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        // Hold both permits for the entire lifetime of the stream
        let _permit = permit;
        let _global = _global_permit;

        defer! {
            ABORT_HANDLES.remove(&request_id_clone);
            REQUEST_CACHE.remove(&request_id_clone);
        }

        log::debug!("Starting streaming for request_id: {}", request_id_clone);

        let stream_start = Instant::now();
        let mut token_count = 0;

        let stream_result = time::timeout(
            Duration::from_secs(STREAM_ABSOLUTE_TIMEOUT_SECS),
            process_chat_stream(&app_clone, &request_id_clone, response, &cancel_token, &mut token_count),
        )
        .await;

        if stream_result.is_err() {
            log::warn!(
                "Chat stream timed out after {} seconds for request_id: {}",
                STREAM_ABSOLUTE_TIMEOUT_SECS,
                request_id_clone
            );
            let _ = app_clone.emit(
                EVENT_OLLAMA_ERROR,
                &BackendError::new("STREAM_TIMEOUT", "Chat stream timed out")
                    .with_request_id(request_id_clone.clone()),
            );
        }

        log::info!(
            "Stream completed for request_id: {} (tokens: {}, duration: {:?})",
            request_id_clone,
            token_count,
            stream_start.elapsed()
        );
    });

    log::info!(
        "Chat request initiated successfully in {:?}",
        start.elapsed()
    );
    ApiResponse {
        success: true,
        data: Some(true),
        error: None,
    }
}

// ==================== ABORT CHAT ====================

#[tauri::command]
pub async fn abort_chat(request_id: String) -> ApiResponse<()> {
    log::info!("Aborting chat request: {}", request_id);

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
pub async fn check_ollama_health(base_url: String) -> ApiResponse<OllamaHealth> {
    log::info!("Checking Ollama health: {}", base_url);
    let start = std::time::Instant::now();

    let _global_permit = match acquire_global_permit().await {
        Ok(p) => p,
        Err(msg) => {
            return ApiResponse {
                success: false,
                data: Some(OllamaHealth {
                    is_running: false,
                    version: None,
                    response_time_ms: 0,
                }),
                error: Some(BackendError::new("RATE_LIMITED", msg)),
            }
        }
    };

    let url = match ollama_endpoint(&base_url, "api/tags") {
        Ok(u) => u,
        Err(msg) => return invalid_ollama_base(msg),
    };

    match FAST_HTTP_CLIENT.get(&url).send().await {
        Ok(resp) => {
            let response_time = start.elapsed().as_millis() as u64;

            // Extract version from Server header (e.g., "Ollama 0.5.6")
            let version = resp
                .headers()
                .get("server")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| {
                    let lower = s.to_ascii_lowercase();
                    // Extract version number after "ollama"
                    lower
                        .strip_prefix("ollama")
                        .or_else(|| lower.strip_prefix("ollama "))
                        .map(|v| v.trim().to_string())
                        .filter(|v| !v.is_empty())
                });

            log::info!(
                "Ollama health check passed ({}ms){}",
                response_time,
                version.as_deref().map(|v| format!(", version: {}", v)).unwrap_or_default()
            );
            ApiResponse {
                success: true,
                data: Some(OllamaHealth {
                    is_running: true,
                    version,
                    response_time_ms: response_time,
                }),
                error: None,
            }
        }
        Err(e) => {
            if e.is_timeout() {
                log::warn!("Ollama health check timed out");
                ApiResponse {
                    success: false,
                    data: Some(OllamaHealth {
                        is_running: false,
                        version: None,
                        response_time_ms: start.elapsed().as_millis() as u64,
                    }),
                    error: Some(
                        BackendError::new("HEALTH_CHECK_TIMEOUT", "Request timed out").retryable(),
                    ),
                }
            } else {
                log::warn!("Ollama health check failed: {}", e);
                ApiResponse {
                    success: false,
                    data: Some(OllamaHealth {
                        is_running: false,
                        version: None,
                        response_time_ms: start.elapsed().as_millis() as u64,
                    }),
                    error: Some(
                        BackendError::new("HEALTH_CHECK_FAILED", e.to_string()).retryable(),
                    ),
                }
            }
        }
    }
}

// Re-export FAST_HTTP_CLIENT used by check_ollama_health
use super::client::FAST_HTTP_CLIENT;
