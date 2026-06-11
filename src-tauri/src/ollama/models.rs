//! Model listing, validation, pulling, deletion, and service verification.
//!
//! Contains the following Tauri commands:
//! - [`cmd_ollama_get_models`] — list installed models
//! - [`cmd_ollama_validate_model`] — check if a model exists on the server
//! - [`cmd_ollama_pull_model`] — stream-download a model from the registry
//! - [`cmd_ollama_abort_pull`] — cancel an in-progress pull
//! - [`cmd_ollama_delete_model`] — remove a model from the server
//! - [`cmd_ollama_verify_service`] — confirm a URL points to an Ollama instance

use crate::error_codes;
use crate::payloads::{
    ApiResponse, BackendError, ModelValidation, OllamaModel, PullProgress, PullStreamError,
};
use crate::validation::{is_valid_model_name, validation_error};
use futures::StreamExt;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::time;
use tokio_util::codec::{FramedRead, LinesCodec};
use tokio_util::sync::CancellationToken;
use tracing;

use super::client::{
    acquire_global_permit, invalid_ollama_base, ollama_endpoint, retry_with_backoff,
    EVENT_PULL_ERROR, EVENT_PULL_PROGRESS, FAST_HTTP_CLIENT, HTTP_CLIENT, PULL_ABORT_HANDLES,
    PULL_ABSOLUTE_TIMEOUT_SECS,
};

// ==================== MODEL LISTING ====================

#[tauri::command]
pub async fn cmd_ollama_get_models(base_url: String) -> ApiResponse<Vec<OllamaModel>> {
    tracing::info!("Fetching Ollama models from: {}", base_url);
    let start = std::time::Instant::now();

    let _global_permit = match acquire_global_permit().await {
        Ok(p) => p,
        Err(msg) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new(error_codes::RATE_LIMITED, msg)),
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
                tracing::info!(
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
                tracing::error!("Failed to parse models response: {}", e);
                ApiResponse {
                    success: false,
                    data: None,
                    error: Some(
                        BackendError::new(error_codes::INVALID_RESPONSE, e.to_string())
                            .with_context("Failed to parse JSON response from Ollama".to_string()),
                    ),
                }
            }
        },
        Err(e) => {
            tracing::error!("Network error fetching models: {}", e);
            ApiResponse {
                success: false,
                data: None,
                error: Some(
                    BackendError::new(error_codes::NETWORK_ERROR, e.to_string())
                        .with_context("Failed to connect to Ollama server".to_string())
                        .retryable(),
                ),
            }
        }
    }
}

// ==================== MODEL VALIDATION ====================

#[tauri::command]
pub async fn cmd_ollama_validate_model(
    base_url: String,
    model_name: String,
) -> ApiResponse<ModelValidation> {
    tracing::info!("Validating model: {}", model_name);

    if !is_valid_model_name(&model_name) {
        return validation_error(
            "INVALID_INPUT",
            format!("Invalid model name: {:?}", model_name),
        );
    }

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
                error: Some(BackendError::new(error_codes::RATE_LIMITED, msg)),
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
        Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>().await {
            Ok(json) => {
                let details =
                    serde_json::from_value(json.get("details").cloned().unwrap_or_default()).ok();
                tracing::info!("Model {} validation successful", model_name);
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
                tracing::error!("Failed to parse model details: {}", e);
                ApiResponse {
                    success: false,
                    data: Some(ModelValidation {
                        is_valid: false,
                        model_name,
                        details: None,
                    }),
                    error: Some(BackendError::new(error_codes::PARSE_ERROR, e.to_string())),
                }
            }
        },
        Ok(_) => {
            tracing::warn!("Model validation failed for {}", model_name);
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
            tracing::error!("Network error validating model: {}", e);
            ApiResponse {
                success: false,
                data: Some(ModelValidation {
                    is_valid: false,
                    model_name,
                    details: None,
                }),
                error: Some(
                    BackendError::new(error_codes::NETWORK_ERROR, e.to_string())
                        .with_context("Failed to connect to Ollama server".to_string())
                        .retryable(),
                ),
            }
        }
    }
}

// ==================== MODEL PULLING ====================

#[tauri::command]
pub async fn cmd_ollama_pull_model<R: Runtime>(
    window: tauri::Window<R>,
    app: AppHandle<R>,
    base_url: String,
    name: String,
) -> ApiResponse<()> {
    // Check rate limiting first
    if let Err(e) =
        crate::rate_limiter::RATE_LIMITER.check_rate_limit(window.label(), "cmd_ollama_pull_model")
    {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        };
    }
    tracing::info!("Starting model pull: {}", name);

    if !is_valid_model_name(&name) {
        return validation_error("INVALID_INPUT", format!("Invalid model name: {:?}", name));
    }

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
                error: Some(BackendError::new(error_codes::RATE_LIMITED, msg)),
            }
        }
    };

    let cancel_token = Arc::new(CancellationToken::new());
    PULL_ABORT_HANDLES.insert(name.clone(), cancel_token.clone());

    let app_clone = app.clone();
    let name_clone = name.clone();

    tokio::spawn(async move {
        let _global = _global_permit;
        let pull_start = std::time::Instant::now();
        let mut last_emit = std::time::Instant::now();

        let pull_result = time::timeout(
            Duration::from_secs(PULL_ABSOLUTE_TIMEOUT_SECS),
            async {
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
                            tracing::error!(
                                "Pull request failed for model {}: HTTP {} — {}",
                                name_clone,
                                status,
                                body
                            );
                            let _ = app_clone.emit(
                                EVENT_PULL_ERROR,
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

                        tracing::info!("Pull request accepted for model: {}", name_clone);

                        let stream = response.bytes_stream();
                        let mut lines = FramedRead::new(
                            tokio_util::io::StreamReader::new(stream.map(|res| {
                                res.map_err(std::io::Error::other)
                            })),
                            LinesCodec::new(),
                        );

                        loop {
                            tokio::select! {
                                _ = cancel_token.cancelled() => {
                                    tracing::info!("Pull cancelled for model: {}", name_clone);
                                    let _ = app_clone.emit(
                                        EVENT_PULL_ERROR,
                                        &PullStreamError {
                                            name: name_clone.clone(),
                                            error: "Pull cancelled".to_string(),
                                            duration: pull_start.elapsed().as_secs(),
                                        },
                                    );
                                    return;
                                }
                                next = time::timeout(Duration::from_secs(1), lines.next()) => {
                                    match next {
                                        Ok(Some(Ok(line))) => {
                                            if let Ok(mut progress_val) =
                                                serde_json::from_str::<serde_json::Value>(&line)
                                            {
                                                if let Some(err) = progress_val.get("error") {
                                                    let msg = err
                                                        .as_str()
                                                        .map(str::to_owned)
                                                        .unwrap_or_else(|| err.to_string());
                                                    tracing::error!("Pull stream error for {}: {}", name_clone, msg);
                                                    let _ = app_clone.emit(
                                                        EVENT_PULL_ERROR,
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
                                                        let _ = app_clone.emit(EVENT_PULL_PROGRESS, &p);
                                                        last_emit = std::time::Instant::now();
                                                    }
                                                }
                                            }
                                        }
                                        Ok(Some(Err(e))) => {
                                            tracing::error!("Stream read error: {}", e);
                                            break;
                                        }
                                        Ok(None) => break,
                                        Err(_) => {
                                            // Timeout - continue loop to check for cancellation
                                        }
                                    }
                                }
                            }
                        }

                        tracing::info!(
                            "Model pull completed: {} (duration: {:?})",
                            name_clone,
                            pull_start.elapsed()
                        );
                    }
                    Err(e) => {
                        tracing::error!("Pull request failed for model {}: {}", name_clone, e);
                        let _ = app_clone.emit(
                            EVENT_PULL_ERROR,
                            &PullStreamError {
                                name: name_clone.clone(),
                                error: e.to_string(),
                                duration: pull_start.elapsed().as_secs(),
                            },
                        );
                    }
                }
            },
        )
        .await;

        if pull_result.is_err() {
            tracing::warn!(
                "Pull timed out after {} seconds for model: {}",
                PULL_ABSOLUTE_TIMEOUT_SECS,
                name_clone
            );
            let _ = app_clone.emit(
                EVENT_PULL_ERROR,
                &PullStreamError {
                    name: name_clone.clone(),
                    error: format!(
                        "Pull timed out after {} seconds",
                        PULL_ABSOLUTE_TIMEOUT_SECS
                    ),
                    duration: pull_start.elapsed().as_secs(),
                },
            );
        }
    });

    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

#[tauri::command]
pub async fn cmd_ollama_abort_pull(name: String) -> ApiResponse<()> {
    tracing::info!("Aborting model pull: {}", name);

    if !is_valid_model_name(&name) {
        return validation_error("INVALID_INPUT", format!("Invalid model name: {:?}", name));
    }

    if let Some((_, token)) = PULL_ABORT_HANDLES.remove(&name) {
        token.cancel();
        tracing::info!("Model pull {} cancelled successfully", name);
    } else {
        tracing::warn!("No active pull found for model: {}", name);
    }

    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

// ==================== MODEL DELETION ====================

#[tauri::command]
pub async fn cmd_ollama_delete_model(base_url: String, name: String) -> ApiResponse<bool> {
    tracing::info!("Deleting model: {}", name);

    if !is_valid_model_name(&name) {
        return validation_error("INVALID_INPUT", format!("Invalid model name: {:?}", name));
    }

    let _global_permit = match acquire_global_permit().await {
        Ok(p) => p,
        Err(msg) => {
            return ApiResponse {
                success: false,
                data: Some(false),
                error: Some(BackendError::new(error_codes::RATE_LIMITED, msg)),
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
            tracing::info!("Model deleted successfully: {}", name);
            ApiResponse {
                success: true,
                data: Some(true),
                error: None,
            }
        }
        Ok(resp) => {
            let status = resp.status().as_u16();
            tracing::error!("Delete failed with status {}: {}", status, name);
            ApiResponse {
                success: false,
                data: Some(false),
                error: Some(BackendError::new(
                    "DELETE_ERROR",
                    format!("HTTP {}", status),
                )),
            }
        }
        Err(e) => {
            tracing::error!("Network error deleting model: {}", e);
            ApiResponse {
                success: false,
                data: Some(false),
                error: Some(
                    BackendError::new(error_codes::NETWORK_ERROR, e.to_string())
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
pub async fn cmd_ollama_verify_service(base_url: String) -> ApiResponse<String> {
    tracing::info!("Verifying Ollama service at: {}", base_url);

    let _global_permit = match acquire_global_permit().await {
        Ok(p) => p,
        Err(msg) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new(error_codes::RATE_LIMITED, msg)),
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
                tracing::info!(
                    "Ollama service verified (server header: {:?})",
                    server_header
                );
                ApiResponse {
                    success: true,
                    data: Some(version),
                    error: None,
                }
            } else {
                tracing::warn!(
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
                tracing::warn!("Service verification timed out");
                ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new(
                        "TIMEOUT",
                        "Connection timed out while verifying server".to_string(),
                    )),
                }
            } else {
                tracing::warn!("Service verification request failed: {}", e);
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
