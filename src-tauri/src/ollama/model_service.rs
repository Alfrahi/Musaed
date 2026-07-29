//! Domain service for Ollama model management.
//!
//! Contains the business logic previously embedded in the Tauri commands:
//! - Model listing (`get_models`)
//! - Model validation (`validate_model`)
//! - Model pulling with streaming progress (`pull_model`)
//! - Model deletion (`delete_model`)
//! - Service verification (`verify_service`)
//!
//! Commands in [`super::models`] are now thin adapters that construct request
//! structs and delegate to this service, following the same pattern as
//! [`super::service::OllamaChatService`].

use super::client::{
    acquire_global_permit, ollama_endpoint, retry_with_backoff, EVENT_PULL_ERROR,
    EVENT_PULL_PROGRESS, FAST_HTTP_CLIENT, HTTP_CLIENT, PULL_ABORT_HANDLES,
    PULL_ABSOLUTE_TIMEOUT_SECS,
};
use crate::error_codes;
use crate::payloads::{BackendError, ModelValidation, OllamaModel, PullProgress, PullStreamError};
use crate::rate_limiter::RATE_LIMITER;
use crate::shared::PULL_PROGRESS_THROTTLE_MS;
use crate::validation::is_valid_model_name;
use futures::StreamExt;
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::time;
use tokio_util::codec::{FramedRead, LinesCodec};
use tokio_util::sync::CancellationToken;
use tracing;

pub struct ModelService;

// ==================== REQUEST STRUCTS ====================

/// Parameters for a model pull operation. Bundles the Tauri window/app handles
/// needed for event emission alongside the model metadata.
pub struct PullModelRequest<R: Runtime> {
    pub app: AppHandle<R>,
    pub window_label: String,
    pub base_url: String,
    pub name: String,
}

// ==================== SERVICE METHODS ====================

impl ModelService {
    /// Lists installed models from the Ollama server.
    pub async fn get_models(&self, base_url: &str) -> Result<Vec<OllamaModel>, BackendError> {
        tracing::info!("Fetching Ollama models from: {}", base_url);
        let start = Instant::now();

        let _global_permit = match acquire_global_permit().await {
            Ok(p) => p,
            Err(msg) => {
                return Err(BackendError::new(error_codes::RATE_LIMITED, msg));
            }
        };

        let url = match ollama_endpoint(base_url, "api/tags") {
            Ok(u) => u,
            Err(msg) => return Err(BackendError::new(error_codes::INVALID_URL, msg)),
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
                    Ok(models)
                }
                Err(e) => {
                    tracing::error!("Failed to parse models response: {}", e);
                    Err(
                        BackendError::new(error_codes::INVALID_RESPONSE, e.to_string())
                            .with_context("Failed to parse JSON response from Ollama".to_string()),
                    )
                }
            },
            Err(e) => {
                tracing::error!("Network error fetching models: {}", e);
                Err(BackendError::new(error_codes::NETWORK_ERROR, e.to_string())
                    .with_context("Failed to connect to Ollama server".to_string())
                    .retryable())
            }
        }
    }

    /// Validates that a model exists on the Ollama server.
    pub async fn validate_model(
        &self,
        base_url: &str,
        model_name: &str,
    ) -> Result<ModelValidation, BackendError> {
        tracing::info!("Validating model: {}", model_name);

        if !is_valid_model_name(model_name) {
            return Err(BackendError::new(
                error_codes::INVALID_INPUT,
                format!("Invalid model name: {:?}", model_name),
            ));
        }

        let _global_permit = match acquire_global_permit().await {
            Ok(p) => p,
            Err(msg) => {
                return Err(BackendError::new(error_codes::RATE_LIMITED, msg));
            }
        };

        let url = match ollama_endpoint(base_url, "api/show") {
            Ok(u) => u,
            Err(msg) => return Err(BackendError::new(error_codes::INVALID_URL, msg)),
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
                        let details = serde_json::from_value(
                            json.get("details").cloned().unwrap_or_default(),
                        )
                        .ok();
                        tracing::info!("Model {} validation successful", model_name);
                        Ok(ModelValidation {
                            is_valid: true,
                            model_name: model_name.to_string(),
                            details,
                        })
                    }
                    Err(e) => {
                        tracing::error!("Failed to parse model details: {}", e);
                        Err(BackendError::new(error_codes::PARSE_ERROR, e.to_string()))
                    }
                }
            }
            Ok(_) => {
                tracing::warn!("Model validation failed for {}", model_name);
                Err(BackendError::new(
                    error_codes::MODEL_NOT_FOUND,
                    "Model doesn't exist on Ollama server",
                ))
            }
            Err(e) => {
                tracing::error!("Network error validating model: {}", e);
                Err(BackendError::new(error_codes::NETWORK_ERROR, e.to_string())
                    .with_context("Failed to connect to Ollama server".to_string())
                    .retryable())
            }
        }
    }

    /// Initiates a streaming model pull. Returns immediately after spawning
    /// the background task that emits progress events.
    pub async fn pull_model<R: Runtime>(
        &self,
        req: PullModelRequest<R>,
    ) -> Result<(), BackendError> {
        // Rate limiting
        RATE_LIMITER.check_rate_limit(&req.window_label, "cmd_ollama_pull_model")?;
        tracing::info!("Starting model pull: {}", req.name);

        if !is_valid_model_name(&req.name) {
            return Err(BackendError::new(
                error_codes::INVALID_INPUT,
                format!("Invalid model name: {:?}", req.name),
            ));
        }

        let url = match ollama_endpoint(&req.base_url, "api/pull") {
            Ok(u) => u,
            Err(msg) => return Err(BackendError::new(error_codes::INVALID_URL, msg)),
        };

        let _global_permit = match acquire_global_permit().await {
            Ok(p) => p,
            Err(msg) => {
                return Err(BackendError::new(error_codes::RATE_LIMITED, msg));
            }
        };

        let cancel_token = Arc::new(CancellationToken::new());
        PULL_ABORT_HANDLES.insert(req.name.clone(), cancel_token.clone());

        let app = req.app.clone();
        let name = req.name.clone();

        tokio::spawn(async move {
            let _global = _global_permit;
            let pull_start = Instant::now();
            let mut last_emit = Instant::now();

            let pull_result = time::timeout(
                Duration::from_secs(PULL_ABSOLUTE_TIMEOUT_SECS),
                async {
                    match HTTP_CLIENT
                        .post(&url)
                        .json(&json!({ "name": name, "stream": true }))
                        .send()
                        .await
                    {
                        Ok(response) => {
                            if !response.status().is_success() {
                                let status = response.status().as_u16();
                                let body = response.text().await.unwrap_or_default();
                                tracing::error!(
                                    "Pull request failed for model {}: HTTP {} — {}",
                                    name,
                                    status,
                                    body
                                );
                                let _ = app.emit(
                                    EVENT_PULL_ERROR,
                                    &PullStreamError {
                                        name: name.clone(),
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

                            tracing::info!("Pull request accepted for model: {}", name);

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
                                        tracing::info!("Pull cancelled for model: {}", name);
                                        let _ = app.emit(
                                            EVENT_PULL_ERROR,
                                            &PullStreamError {
                                                name: name.clone(),
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
                                                        tracing::error!("Pull stream error for {}: {}", name, msg);
                                                        let _ = app.emit(
                                                            EVENT_PULL_ERROR,
                                                            &PullStreamError {
                                                                name: name.clone(),
                                                                error: msg,
                                                                duration: pull_start.elapsed().as_secs(),
                                                            },
                                                        );
                                                        return;
                                                    }

                                                    if let Some(obj) = progress_val.as_object_mut() {
                                                        obj.insert("name".to_string(), json!(name));
                                                    }

                                                    if let Ok(p) = serde_json::from_value::<PullProgress>(progress_val) {
                                                        if last_emit.elapsed().as_millis() as u64
                                                            > PULL_PROGRESS_THROTTLE_MS
                                                            || p.status.contains("success")
                                                        {
                                                            let _ = app.emit(EVENT_PULL_PROGRESS, &p);
                                                            last_emit = Instant::now();
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
                                name,
                                pull_start.elapsed()
                            );
                        }
                        Err(e) => {
                            tracing::error!("Pull request failed for model {}: {}", name, e);
                            let _ = app.emit(
                                EVENT_PULL_ERROR,
                                &PullStreamError {
                                    name: name.clone(),
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
                    name
                );
                let _ = app.emit(
                    EVENT_PULL_ERROR,
                    &PullStreamError {
                        name: name.clone(),
                        error: format!(
                            "Pull timed out after {} seconds",
                            PULL_ABSOLUTE_TIMEOUT_SECS
                        ),
                        duration: pull_start.elapsed().as_secs(),
                    },
                );
            }
        });

        Ok(())
    }

    /// Deletes a model from the Ollama server.
    pub async fn delete_model(&self, base_url: &str, name: &str) -> Result<bool, BackendError> {
        tracing::info!("Deleting model: {}", name);

        if !is_valid_model_name(name) {
            return Err(BackendError::new(
                error_codes::INVALID_INPUT,
                format!("Invalid model name: {:?}", name),
            ));
        }

        let _global_permit = match acquire_global_permit().await {
            Ok(p) => p,
            Err(msg) => {
                return Err(BackendError::new(error_codes::RATE_LIMITED, msg));
            }
        };

        let url = match ollama_endpoint(base_url, "api/delete") {
            Ok(u) => u,
            Err(msg) => return Err(BackendError::new(error_codes::INVALID_URL, msg)),
        };

        match FAST_HTTP_CLIENT
            .delete(&url)
            .json(&json!({ "name": name }))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                tracing::info!("Model deleted successfully: {}", name);
                Ok(true)
            }
            Ok(resp) => {
                let status = resp.status().as_u16();
                tracing::error!("Delete failed with status {}: {}", status, name);
                Err(BackendError::new(
                    error_codes::DELETE_ERROR,
                    format!("HTTP {}", status),
                ))
            }
            Err(e) => {
                tracing::error!("Network error deleting model: {}", e);
                Err(BackendError::new(error_codes::NETWORK_ERROR, e.to_string())
                    .with_context("Failed to connect to Ollama server".to_string())
                    .retryable())
            }
        }
    }

    /// Verifies that the given base URL points to an Ollama instance
    /// by requesting `/` and checking the `Server` response header.
    pub async fn verify_service(&self, base_url: &str) -> Result<String, BackendError> {
        tracing::info!("Verifying Ollama service at: {}", base_url);

        let _global_permit = match acquire_global_permit().await {
            Ok(p) => p,
            Err(msg) => {
                return Err(BackendError::new(error_codes::RATE_LIMITED, msg));
            }
        };

        let url = match ollama_endpoint(base_url, "") {
            Ok(u) => u,
            Err(msg) => return Err(BackendError::new(error_codes::INVALID_URL, msg)),
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
                    Ok(version)
                } else {
                    tracing::warn!(
                        "Service at {} does not appear to be Ollama (server header: {:?})",
                        url,
                        server_header
                    );
                    Err(BackendError::new(
                        error_codes::NOT_OLLAMA,
                        "The server at this address does not appear to be Ollama".to_string(),
                    ))
                }
            }
            Err(e) => {
                if e.is_timeout() {
                    tracing::warn!("Service verification timed out");
                    Err(BackendError::new(
                        error_codes::TIMEOUT,
                        "Connection timed out while verifying server".to_string(),
                    ))
                } else {
                    tracing::warn!("Service verification request failed: {}", e);
                    Err(BackendError::new(
                        error_codes::CONNECTION_FAILED,
                        "Could not connect to the server".to_string(),
                    ))
                }
            }
        }
    }
}
