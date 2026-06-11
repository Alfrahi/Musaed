//! Ollama business logic service.
//!
//! Contains the core domain logic for Ollama operations, extracted from Tauri
//! commands to satisfy the "thin adapter" rule. Commands should only handle
//! Tauri-specific concerns (event emitting, state access) and delegate business
//! rules to this service.

use super::client::{
    acquire_global_permit, ollama_endpoint, request_cache_try_insert, retry_with_backoff,
    ABORT_HANDLES, CONCURRENT_SEMAPHORE, EVENT_OLLAMA_ERROR, FAST_HTTP_CLIENT, HTTP_CLIENT,
    INITIAL_REQUEST_TIMEOUT_SECS, MAX_TOTAL_IMAGE_SIZE_BYTES, REQUEST_CACHE,
    STREAM_ABSOLUTE_TIMEOUT_SECS,
};
use super::streaming::process_chat_stream;
use crate::error_codes;
use crate::payloads::{BackendError, ChatMessage, ChatOptions, OllamaHealth};
use crate::validation::{
    is_valid_model_name, is_valid_request_id, validate_chat_message, validate_chat_options,
    MAX_MESSAGES_COUNT,
};
use scopeguard::defer;
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::time;
use tokio_util::sync::CancellationToken;
use tracing;

pub struct OllamaChatService;

impl OllamaChatService {
    /// Executes an Ollama chat request with full business logic:
    /// - Validation
    /// - Rate limiting (global + per-project concurrency)
    /// - Duplicate request detection
    /// - Retry with backoff
    /// - Streaming with timeout and abort support
    ///
    /// Returns `Ok(())` on successful spawn of the streaming task.
    /// Returns `Err(BackendError)` on any failure before or during HTTP request.
    pub async fn chat<R: Runtime>(
        &self,
        app: AppHandle<R>,
        base_url: String,
        model: String,
        messages: Vec<ChatMessage>,
        options: ChatOptions,
        request_id: String,
    ) -> Result<(), BackendError> {
        tracing::info!(
            "Starting chat request: request_id={}, model={}",
            request_id,
            model
        );
        let start = Instant::now();

        // --- Input validation ---
        if !is_valid_model_name(&model) {
            return Err(BackendError::new(
                error_codes::INVALID_INPUT,
                format!("Invalid model name: {:?}", model),
            ));
        }
        if !is_valid_request_id(&request_id) {
            return Err(BackendError::new(
                error_codes::INVALID_INPUT,
                format!("Invalid request_id: {:?}", request_id),
            ));
        }
        if messages.len() > MAX_MESSAGES_COUNT {
            return Err(BackendError::new(
                "INVALID_INPUT",
                format!(
                    "Too many messages: {} (max {})",
                    messages.len(),
                    MAX_MESSAGES_COUNT
                ),
            ));
        }
        for msg in &messages {
            if let Err(e) = validate_chat_message(msg) {
                return Err(BackendError::new(error_codes::INVALID_INPUT, e));
            }
        }
        if let Err(e) = validate_chat_options(&options) {
            return Err(BackendError::new(error_codes::INVALID_INPUT, e));
        }

        // Image size safety check
        let total_b64_len: usize = messages
            .iter()
            .filter_map(|m| m.images.as_ref())
            .flatten()
            .map(|s| s.len())
            .sum();

        if total_b64_len > (MAX_TOTAL_IMAGE_SIZE_BYTES * 4 / 3 + 1024) {
            return Err(BackendError::new(
                "FILE_TOO_LARGE",
                format!(
                    "Total image size exceeds {} MiB limit",
                    MAX_TOTAL_IMAGE_SIZE_BYTES / 1024 / 1024
                ),
            ));
        }

        let url = match ollama_endpoint(&base_url, "api/chat") {
            Ok(u) => u,
            Err(msg) => return Err(BackendError::new(error_codes::INVALID_URL, msg)),
        };

        let _global_permit = match acquire_global_permit().await {
            Ok(p) => p,
            Err(msg) => {
                return Err(BackendError::new(error_codes::RATE_LIMITED, msg));
            }
        };

        // Atomic duplicate check (bounded insert with LRU eviction)
        if !request_cache_try_insert(request_id.clone()) {
            tracing::warn!("Duplicate request detected: {}", request_id);
            return Err(BackendError::new(
                error_codes::DUPLICATE_REQUEST,
                "Request already in progress",
            )
            .with_request_id(request_id));
        }

        let permit = match CONCURRENT_SEMAPHORE.acquire().await {
            Ok(p) => p,
            Err(_) => {
                REQUEST_CACHE.remove(&request_id);
                return Err(BackendError::new(
                    "RATE_LIMITED",
                    "Too many concurrent requests",
                ));
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
                tracing::error!("Failed to send chat request: {}", e);
                ABORT_HANDLES.remove(&request_id);
                REQUEST_CACHE.remove(&request_id);
                return Err(
                    BackendError::new(error_codes::INTERNAL_ERROR, e.to_string())
                        .with_request_id(request_id)
                        .with_context("Failed to connect to Ollama chat endpoint".to_string())
                        .retryable(),
                );
            }
        };

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let error_text = response.text().await.unwrap_or_default();
            tracing::error!("Ollama returned error status {}: {}", status, error_text);

            ABORT_HANDLES.remove(&request_id);
            REQUEST_CACHE.remove(&request_id);
            return Err(BackendError::new(error_codes::OLLAMA_ERROR, error_text)
                .with_request_id(request_id)
                .with_context(format!("HTTP Status: {}", status)));
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

            tracing::debug!("Starting streaming for request_id: {}", request_id_clone);

            let stream_start = Instant::now();
            let mut token_count = 0;

            let stream_result = time::timeout(
                Duration::from_secs(STREAM_ABSOLUTE_TIMEOUT_SECS),
                process_chat_stream(
                    &app_clone,
                    &request_id_clone,
                    response,
                    &cancel_token,
                    &mut token_count,
                ),
            )
            .await;

            if stream_result.is_err() {
                tracing::warn!(
                    "Chat stream timed out after {} seconds for request_id: {}",
                    STREAM_ABSOLUTE_TIMEOUT_SECS,
                    request_id_clone
                );
                let _ = app_clone.emit(
                    EVENT_OLLAMA_ERROR,
                    &BackendError::new(error_codes::STREAM_TIMEOUT, "Chat stream timed out")
                        .with_request_id(request_id_clone.clone()),
                );
            }

            tracing::info!(
                "Stream completed for request_id: {} (tokens: {}, duration: {:?})",
                request_id_clone,
                token_count,
                stream_start.elapsed()
            );
        });

        tracing::info!(
            "Chat request initiated successfully in {:?}",
            start.elapsed()
        );
        Ok(())
    }

    /// Performs a health check against the Ollama server.
    pub async fn health_check(&self, base_url: String) -> Result<OllamaHealth, BackendError> {
        tracing::info!("Checking Ollama health: {}", base_url);
        let start = Instant::now();

        let _global_permit = match acquire_global_permit().await {
            Ok(p) => p,
            Err(msg) => {
                return Err(BackendError::new(error_codes::RATE_LIMITED, msg));
            }
        };

        let url = match ollama_endpoint(&base_url, "api/tags") {
            Ok(u) => u,
            Err(msg) => return Err(BackendError::new(error_codes::INVALID_URL, msg)),
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

                tracing::info!(
                    "Ollama health check passed ({}ms){}",
                    response_time,
                    version
                        .as_deref()
                        .map(|v| format!(", version: {}", v))
                        .unwrap_or_default()
                );
                Ok(OllamaHealth {
                    is_running: true,
                    version,
                    response_time_ms: response_time,
                })
            }
            Err(e) => {
                if e.is_timeout() {
                    tracing::warn!("Ollama health check timed out");
                    Err(
                        BackendError::new(error_codes::HEALTH_CHECK_TIMEOUT, "Request timed out")
                            .retryable(),
                    )
                } else {
                    tracing::warn!("Ollama health check failed: {}", e);
                    Err(
                        BackendError::new(error_codes::HEALTH_CHECK_FAILED, e.to_string())
                            .retryable(),
                    )
                }
            }
        }
    }
}
