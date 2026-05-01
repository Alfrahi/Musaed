//! Tauri commands for Ollama model management, chat, and health checks.

use crate::payloads::{
    ApiResponse, BackendError, ChatMessage, ChatOptions, ModelValidation, OllamaHealth,
    OllamaModel, OllamaToken, PullProgress, PullStreamError,
};
use crate::shared::{
    acquire_global_permit, invalid_ollama_base, ollama_endpoint, retry_with_backoff,
    ABORT_HANDLES, CONCURRENT_SEMAPHORE, FAST_HTTP_CLIENT, HTTP_CLIENT,
    INITIAL_REQUEST_TIMEOUT_SECS, MAX_TOTAL_IMAGE_SIZE_BYTES, REQUEST_CACHE,
    STREAM_ABSOLUTE_TIMEOUT_SECS, STREAM_IDLE_TIMEOUT_SECS,
};
use dashmap::mapref::entry::Entry;
use futures::StreamExt;
use scopeguard::defer;
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::time;
use tokio_util::codec::{FramedRead, LinesCodec};
use tokio_util::sync::CancellationToken;

// ==================== OLLAMA MODELS ====================

#[tauri::command]
pub async fn get_ollama_models(base_url: String) -> ApiResponse<Vec<OllamaModel>> {
    log::info!("Fetching Ollama models from: {}", base_url);
    let start = std::time::Instant::now();

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

    let url = match ollama_endpoint(&base_url, "api/tags") {
        Ok(u) => u,
        Err(msg) => return invalid_ollama_base(msg),
    };

    match retry_with_backoff(
        || {
            let url = url.clone();
            async move { FAST_HTTP_CLIENT.get(&url).send().await }
        },
        2,
        500,
    )
    .await
    {
        Ok(resp) => match resp.json::<serde_json::Value>().await {
            Ok(json) => {
                let models: Vec<OllamaModel> = serde_json::from_value(
                    json.get("models").cloned().unwrap_or_else(|| json!([])),
                )
                .unwrap_or_default();
                log::info!(
                    "Successfully fetched {} models in {:?}",
                    models.len(),
                    start.elapsed()
                );
                ApiResponse {
                    success: true,
                    data: Some(models),
                    error: None,
                }
            }
            Err(e) => {
                log::error!("Failed to parse models response: {}", e);
                ApiResponse {
                    success: false,
                    data: None,
                    error: Some(
                        BackendError::new("INVALID_RESPONSE", e.to_string())
                            .with_context(
                                "Failed to parse JSON response from Ollama".to_string(),
                            ),
                    ),
                }
            }
        },
        Err(e) => {
            log::error!("Network error fetching models: {}", e);
            ApiResponse {
                success: false,
                data: None,
                error: Some(
                    BackendError::new("NETWORK_ERROR", e.to_string())
                        .with_context("Failed to connect to Ollama server".to_string())
                        .retryable(),
                ),
            }
        }
    }
}

// ==================== CHAT OPERATIONS ====================

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

    // Atomic duplicate check
    match REQUEST_CACHE.entry(request_id.clone()) {
        Entry::Occupied(_) => {
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
        Entry::Vacant(e) => {
            e.insert(Instant::now());
        }
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
                "ollama-error",
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

/// Processes the SSE stream from Ollama's chat endpoint, emitting tokens as Tauri events.
async fn process_chat_stream<R: Runtime>(
    app: &AppHandle<R>,
    request_id: &str,
    response: reqwest::Response,
    cancel_token: &CancellationToken,
    token_count: &mut u64,
) {
    let stream = response.bytes_stream();
    let mut lines = FramedRead::new(
        tokio_util::io::StreamReader::new(
            stream.map(|res| res.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))),
        ),
        LinesCodec::new(),
    );

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                log::info!("Stream cancelled for request_id: {}", request_id);
                break;
            }
            next = time::timeout(Duration::from_secs(STREAM_IDLE_TIMEOUT_SECS), lines.next()) => {
                match next {
                    Ok(Some(Ok(line))) => {
                        if line.trim().is_empty() {
                            continue;
                        }

                        match serde_json::from_str::<serde_json::Value>(&line) {
                            Ok(mut token_data) => {
                                if let Some(err) = token_data.get("error") {
                                    let msg = err.as_str().map(str::to_owned).unwrap_or_else(|| err.to_string());
                                    let _ = app.emit(
                                        "ollama-error",
                                        &BackendError::new("OLLAMA_ERROR", msg)
                                            .with_request_id(request_id.to_string()),
                                    );
                                    break;
                                }

                                if let Some(obj) = token_data.as_object_mut() {
                                    obj.insert("requestId".to_string(), json!(request_id));
                                }

                                match serde_json::from_value::<OllamaToken>(token_data) {
                                    Ok(token) => {
                                        *token_count += 1;
                                        let _ = app.emit("ollama-token", &token);
                                    }
                                    Err(e) => log::warn!("Failed to parse token: {}", e),
                                }
                            }
                            Err(e) => log::warn!("Failed to parse JSON line: {}", e),
                        }
                    }
                    Ok(Some(Err(e))) => {
                        log::error!("Stream read error: {}", e);
                        break;
                    }
                    Ok(None) => break,
                    Err(_) => {
                        log::warn!("Idle timeout on stream for request_id: {}", request_id);
                        let _ = app.emit(
                            "ollama-error",
                            &BackendError::new("STREAM_IDLE_TIMEOUT", "No data received for too long")
                                .with_request_id(request_id.to_string()),
                        );
                        break;
                    }
                }
            }
        }
    }
}

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

// ==================== MODEL MANAGEMENT ====================

#[tauri::command]
pub async fn validate_model(
    base_url: String,
    model_name: String,
) -> ApiResponse<ModelValidation> {
    log::info!("Validating model: {}", model_name);

    let _global_permit = match acquire_global_permit().await {
        Ok(p) => p,
        Err(msg) => {
            return ApiResponse {
                success: false,
                data: Some(ModelValidation {
                    is_valid: false,
                    model_name: model_name.clone(),
                    details: None,
                }),
                error: Some(BackendError::new("RATE_LIMITED", msg)),
            }
        }
    };

    let url = match ollama_endpoint(&base_url, "api/show") {
        Ok(u) => u,
        Err(msg) => return invalid_ollama_base(msg),
    };

    match FAST_HTTP_CLIENT
        .post(&url)
        .json(&json!({ "name": model_name }))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<serde_json::Value>().await {
                Ok(json) => {
                    let details =
                        serde_json::from_value(json.get("details").cloned().unwrap_or_default())
                            .ok();
                    log::info!("Model {} validation successful", model_name);
                    ApiResponse {
                        success: true,
                        data: Some(ModelValidation {
                            is_valid: true,
                            model_name: model_name.clone(),
                            details,
                        }),
                        error: None,
                    }
                }
                Err(e) => {
                    log::error!("Failed to parse model details: {}", e);
                    ApiResponse {
                        success: false,
                        data: Some(ModelValidation {
                            is_valid: false,
                            model_name,
                            details: None,
                        }),
                        error: Some(BackendError::new("PARSE_ERROR", e.to_string())),
                    }
                }
            }
        }
        Ok(_) => {
            log::warn!("Model validation failed for {}", model_name);
            ApiResponse {
                success: false,
                data: Some(ModelValidation {
                    is_valid: false,
                    model_name,
                    details: None,
                }),
                error: Some(BackendError::new(
                    "MODEL_NOT_FOUND",
                    "Model doesn't exist on Ollama server",
                )),
            }
        }
        Err(e) => {
            log::error!("Network error validating model: {}", e);
            ApiResponse {
                success: false,
                data: Some(ModelValidation {
                    is_valid: false,
                    model_name,
                    details: None,
                }),
                error: Some(
                    BackendError::new("NETWORK_ERROR", e.to_string())
                        .with_context("Failed to connect to Ollama server".to_string())
                        .retryable(),
                ),
            }
        }
    }
}

#[tauri::command]
pub async fn pull_model<R: Runtime>(
    app: AppHandle<R>,
    base_url: String,
    name: String,
) -> ApiResponse<()> {
    log::info!("Starting model pull: {}", name);

    let url = match ollama_endpoint(&base_url, "api/pull") {
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

    let app_clone = app.clone();
    let name_clone = name.clone();

    tokio::spawn(async move {
        let _global = _global_permit;
        let pull_start = std::time::Instant::now();
        let mut last_emit = std::time::Instant::now();

        match HTTP_CLIENT
            .post(&url)
            .json(&json!({ "name": name_clone, "stream": true }))
            .send()
            .await
        {
            Ok(response) => {
                if !response.status().is_success() {
                    let status = response.status().as_u16();
                    let body = response.text().await.unwrap_or_default();
                    log::error!(
                        "Pull request failed for model {}: HTTP {} — {}",
                        name_clone,
                        status,
                        body
                    );
                    let _ = app_clone.emit(
                        "pull-error",
                        &PullStreamError {
                            name: name_clone.clone(),
                            error: format!(
                                "HTTP {}: {}",
                                status,
                                body.chars().take(500).collect::<String>()
                            ),
                            duration: pull_start.elapsed().as_secs(),
                        },
                    );
                    return;
                }

                log::info!("Pull request accepted for model: {}", name_clone);

                let stream = response.bytes_stream();
                let mut lines = FramedRead::new(
                    tokio_util::io::StreamReader::new(stream.map(|res| {
                        res.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
                    })),
                    LinesCodec::new(),
                );

                while let Some(Ok(line)) = lines.next().await {
                    if let Ok(mut progress_val) =
                        serde_json::from_str::<serde_json::Value>(&line)
                    {
                        if let Some(err) = progress_val.get("error") {
                            let msg = err
                                .as_str()
                                .map(str::to_owned)
                                .unwrap_or_else(|| err.to_string());
                            log::error!("Pull stream error for {}: {}", name_clone, msg);
                            let _ = app_clone.emit(
                                "pull-error",
                                &PullStreamError {
                                    name: name_clone.clone(),
                                    error: msg,
                                    duration: pull_start.elapsed().as_secs(),
                                },
                            );
                            return;
                        }

                        if let Some(obj) = progress_val.as_object_mut() {
                            obj.insert("name".to_string(), json!(name_clone));
                        }

                        if let Ok(p) = serde_json::from_value::<PullProgress>(progress_val) {
                            if last_emit.elapsed().as_millis() as u64
                                > crate::shared::PULL_PROGRESS_THROTTLE_MS
                                || p.status.contains("success")
                            {
                                let _ = app_clone.emit("pull-progress", &p);
                                last_emit = std::time::Instant::now();
                            }
                        }
                    }
                }

                log::info!(
                    "Model pull completed: {} (duration: {:?})",
                    name_clone,
                    pull_start.elapsed()
                );
            }
            Err(e) => {
                log::error!("Pull request failed for model {}: {}", name_clone, e);
                let _ = app_clone.emit(
                    "pull-error",
                    &PullStreamError {
                        name: name_clone.clone(),
                        error: e.to_string(),
                        duration: pull_start.elapsed().as_secs(),
                    },
                );
            }
        }
    });

    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

#[tauri::command]
pub async fn delete_model(base_url: String, name: String) -> ApiResponse<bool> {
    log::info!("Deleting model: {}", name);

    let _global_permit = match acquire_global_permit().await {
        Ok(p) => p,
        Err(msg) => {
            return ApiResponse {
                success: false,
                data: Some(false),
                error: Some(BackendError::new("RATE_LIMITED", msg)),
            }
        }
    };

    let url = match ollama_endpoint(&base_url, "api/delete") {
        Ok(u) => u,
        Err(msg) => return invalid_ollama_base(msg),
    };

    match FAST_HTTP_CLIENT
        .delete(&url)
        .json(&json!({ "name": name }))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            log::info!("Model deleted successfully: {}", name);
            ApiResponse {
                success: true,
                data: Some(true),
                error: None,
            }
        }
        Ok(resp) => {
            let status = resp.status().as_u16();
            log::error!("Delete failed with status {}: {}", status, name);
            ApiResponse {
                success: false,
                data: Some(false),
                error: Some(BackendError::new("DELETE_ERROR", format!("HTTP {}", status))),
            }
        }
        Err(e) => {
            log::error!("Network error deleting model: {}", e);
            ApiResponse {
                success: false,
                data: Some(false),
                error: Some(
                    BackendError::new("NETWORK_ERROR", e.to_string())
                        .with_context("Failed to connect to Ollama server".to_string())
                        .retryable(),
                ),
            }
        }
    }
}

// ==================== SERVICE VERIFICATION ====================

/// Verifies that the given base URL actually points to an Ollama instance
/// by requesting `/` and checking the `Server` response header.
#[tauri::command]
pub async fn verify_ollama_service(base_url: String) -> ApiResponse<String> {
    log::info!("Verifying Ollama service at: {}", base_url);

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

    let url = match ollama_endpoint(&base_url, "") {
        Ok(u) => u,
        Err(msg) => return invalid_ollama_base(msg),
    };

    match FAST_HTTP_CLIENT.get(&url).send().await {
        Ok(resp) => {
            let server_header = resp
                .headers()
                .get("server")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_ascii_lowercase();

            if server_header.contains("ollama") {
                let version = server_header.clone();
                log::info!("Ollama service verified (server header: {:?})", server_header);
                ApiResponse {
                    success: true,
                    data: Some(version),
                    error: None,
                }
            } else {
                log::warn!(
                    "Service at {} does not appear to be Ollama (server header: {:?})",
                    url,
                    server_header
                );
                ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new(
                        "NOT_OLLAMA",
                        "The server at this address does not appear to be Ollama".to_string(),
                    )),
                }
            }
        }
        Err(e) => {
            if e.is_timeout() {
                log::warn!("Service verification timed out");
                ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new(
                        "TIMEOUT",
                        "Connection timed out while verifying server".to_string(),
                    )),
                }
            } else {
                log::warn!("Service verification request failed: {}", e);
                ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new(
                        "CONNECTION_FAILED",
                        "Could not connect to the server".to_string(),
                    )),
                }
            }
        }
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
            let response_time = start.elapsed().as_millis();

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
                        response_time_ms: start.elapsed().as_millis(),
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
                        response_time_ms: start.elapsed().as_millis(),
                    }),
                    error: Some(
                        BackendError::new("HEALTH_CHECK_FAILED", e.to_string()).retryable(),
                    ),
                }
            }
        }
    }
}
