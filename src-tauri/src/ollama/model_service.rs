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

use crate::error_codes;
use crate::ollama::modelfile::{clamp_ctx, parse_modelfile_parameters};
use crate::ollama::pull_stream::process_pull_stream;
use crate::payloads::{BackendError, ModelValidation, OllamaModel, PullStreamError};
use crate::rate_limiter::RATE_LIMITER;
use crate::shared::{
    acquire_global_permit, ollama_endpoint, retry_with_backoff, EVENT_PULL_ERROR, FAST_HTTP_CLIENT,
    HTTP_CLIENT, PULL_ABORT_HANDLES, PULL_ABSOLUTE_TIMEOUT_SECS,
};
use crate::validation::is_valid_model_name;
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::time;
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
                        let details: Option<crate::payloads::OllamaModelDetails> =
                            serde_json::from_value(
                                json.get("details").cloned().unwrap_or_default(),
                            )
                            .ok();

                        // Extract the model's context_length from `model_info`.
                        // The key is architecture-prefixed (e.g.
                        // `llama.context_length`, `qwen2.context_length`).
                        // When multiple `.context_length` keys exist (common
                        // for quantized models that carry both
                        // `general.context_length` and `<family>.context_length`),
                        // prefer the one whose prefix matches the model's
                        // architecture family, then fall back to the max
                        // numeric value. The result is clamped to
                        // `NUM_CTX_RANGE`.
                        let family: Option<&str> =
                            details.as_ref().and_then(|d| d.family.as_deref());

                        let context_length = json
                            .get("model_info")
                            .and_then(|mi| mi.as_object())
                            .and_then(|obj| {
                                // Collect all `.context_length` candidates,
                                // extracting the architecture prefix (the part
                                // before `.context_length`) and the numeric
                                // value. Non-numeric values are silently dropped.
                                let candidates: Vec<(&str, u64)> = obj
                                    .iter()
                                    .filter_map(|(k, v)| {
                                        let key = k.as_str();
                                        let prefix = key.strip_suffix(".context_length")?;
                                        v.as_u64().map(|n| (prefix, n))
                                    })
                                    .collect();

                                if candidates.is_empty() {
                                    return None;
                                }

                                // Prefer the candidate whose prefix matches
                                // the model's architecture family.
                                if let Some(fam) = family {
                                    if let Some((_, n)) =
                                        candidates.iter().find(|(prefix, _)| *prefix == fam)
                                    {
                                        return Some(clamp_ctx(*n));
                                    }
                                }

                                // Fall back to the max numeric value.
                                let max = candidates.iter().map(|(_, n)| *n).max()?;
                                Some(clamp_ctx(max))
                            })
                            .flatten();

                        // Extract per-model sampling defaults from the
                        // Modelfile's `PARAMETER` directives. Ollama exposes
                        // these as a top-level `parameters` string field on
                        // `/api/show` (newline-separated
                        // `PARAMETER key value` lines). `None` on the outer
                        // field means the string was absent or completely
                        // unparseable; individual fields are `None` when
                        // their directive is missing or malformed.
                        let default_params = json
                            .get("parameters")
                            .and_then(|p| p.as_str())
                            .and_then(parse_modelfile_parameters);

                        tracing::info!(
                            "Model {} validation successful (context_length={:?}, default_params={:?})",
                            model_name,
                            context_length,
                            default_params
                        );
                        Ok(ModelValidation {
                            is_valid: true,
                            model_name: model_name.to_string(),
                            details,
                            context_length,
                            default_params,
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

            let pull_result =
                time::timeout(Duration::from_secs(PULL_ABSOLUTE_TIMEOUT_SECS), async {
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

                            process_pull_stream(&app, &name, response, &cancel_token, pull_start)
                                .await;
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
                })
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
    pub async fn delete_model(
        &self,
        window_label: &str,
        base_url: &str,
        name: &str,
    ) -> Result<bool, BackendError> {
        RATE_LIMITER.check_rate_limit(window_label, "cmd_ollama_delete_model")?;
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
