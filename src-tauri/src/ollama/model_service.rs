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
use crate::generated_validation::NUM_CTX_RANGE;
use crate::payloads::{
    BackendError, ModelDefaultParams, ModelValidation, OllamaModel, PullProgress, PullStreamError,
};
use crate::rate_limiter::RATE_LIMITER;
use crate::shared::{
    acquire_global_permit, ollama_endpoint, retry_with_backoff, EVENT_PULL_ERROR,
    EVENT_PULL_PROGRESS, FAST_HTTP_CLIENT, HTTP_CLIENT, PULL_ABORT_HANDLES,
    PULL_ABSOLUTE_TIMEOUT_SECS, PULL_PROGRESS_THROTTLE_MS,
};
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

/// Clamp a raw context_length value to the `NUM_CTX_RANGE` bounds and
/// convert to `u32`. Values above the ceiling are capped to the max
/// supported `num_ctx`; values below the floor are raised to the minimum.
/// Malformed (non-numeric) values are filtered out before this is called.
fn clamp_ctx(n: u64) -> Option<u32> {
    let min = NUM_CTX_RANGE.0 as u64;
    let max = NUM_CTX_RANGE.1 as u64;
    let clamped = n.clamp(min, max);
    u32::try_from(clamped).ok()
}

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

// ====================== PULL STREAM PROCESSOR ======================

/// Process a streaming model pull response, emitting progress events.
///
/// Reads newline-delimited JSON from the response body, parses each line as
/// [`PullProgress`], and emits `EVENT_PULL_PROGRESS` events (throttled to
/// `PULL_PROGRESS_THROTTLE_MS`).  Handles cancellation, stream errors, and
/// error lines from the Ollama API.
///
/// This is the pull-stream analogue of [`process_chat_stream`] in
/// `super::streaming`.
async fn process_pull_stream<R: Runtime>(
    app: &AppHandle<R>,
    name: &str,
    response: reqwest::Response,
    cancel_token: &CancellationToken,
    pull_start: Instant,
) {
    let mut last_emit = Instant::now();

    let stream = response.bytes_stream();
    let mut lines = FramedRead::new(
        tokio_util::io::StreamReader::new(stream.map(|res| res.map_err(std::io::Error::other))),
        LinesCodec::new(),
    );

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                tracing::info!("Pull cancelled for model: {}", name);
                let _ = app.emit(
                    EVENT_PULL_ERROR,
                    &PullStreamError {
                        name: name.to_string(),
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
                                        name: name.to_string(),
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
                        // Timeout — continue loop to check for cancellation
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

// ==================== MODFILE PARAMETER PARSER ====================

/// Parse a Modelfile's `parameters` string (as returned by Ollama's
/// `/api/show` top-level `parameters` field) into a `ModelDefaultParams`.
///
/// The Ollama `/api/show` response exposes the `parameters` field as a
/// pre-parsed string where each line is `<key><whitespace><value>` (the
/// `PARAMETER` prefix from the Modelfile source is stripped by Ollama).
/// Values may be quoted (e.g. `stop "<|eot_id|>"`). Only the five sampled
/// fields are extracted: `temperature`, `top_p`, `top_k`, `num_ctx`,
/// `num_predict`. Unknown keys, malformed values, blank lines, and quoted
/// string values (used by `stop`) are silently ignored. Returns `None` only
/// when none of the five known keys were successfully parsed (caller treats
/// the whole `default_params` field as absent in that case).
fn parse_modelfile_parameters(raw: &str) -> Option<ModelDefaultParams> {
    let mut temperature: Option<f64> = None;
    let mut top_p: Option<f64> = None;
    let mut top_k: Option<i32> = None;
    let mut num_ctx: Option<u32> = None;
    let mut num_predict: Option<i32> = None;

    for line in raw.lines() {
        let line = line.trim();
        // Each line is `key<whitespace>value`. `split_whitespace` folds
        // runs of spaces/tabs, so `key   value` → ["key", "value"].
        let mut tokens = line.split_whitespace();
        let key = match tokens.next() {
            Some(k) => k,
            None => continue,
        };
        let value = match tokens.next() {
            Some(v) => v,
            None => continue,
        };
        match key {
            "temperature" if temperature.is_none() => {
                temperature = value.parse::<f64>().ok();
            }
            "top_p" if top_p.is_none() => {
                top_p = value.parse::<f64>().ok();
            }
            "top_k" if top_k.is_none() => {
                top_k = value.parse::<i32>().ok();
            }
            "num_ctx" if num_ctx.is_none() => {
                num_ctx = value.parse::<u32>().ok();
            }
            "num_predict" if num_predict.is_none() => {
                // Ollama's Modelfile convention uses `num_predict -1` to mean
                // "unbounded". Our chat validation now accepts `-1` as a
                // valid sentinel, so we pass it through instead of
                // treating it as absent.
                num_predict = value.parse::<i32>().ok();
            }
            _ => {}
        }
    }

    let params = ModelDefaultParams {
        temperature,
        top_p,
        top_k,
        num_ctx,
        num_predict,
    };
    // If nothing parsed, signal absence with `None` so the struct is dropped
    // entirely and clients fall back to DEFAULT_MODEL_PARAMS for every field.
    if params.temperature.is_none()
        && params.top_p.is_none()
        && params.top_k.is_none()
        && params.num_ctx.is_none()
        && params.num_predict.is_none()
    {
        None
    } else {
        Some(params)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_ctx_within_range() {
        assert_eq!(clamp_ctx(8192), Some(8192));
    }

    #[test]
    fn clamp_ctx_above_max() {
        assert_eq!(clamp_ctx(4_000_000), Some(NUM_CTX_RANGE.1));
    }

    #[test]
    fn clamp_ctx_below_min() {
        assert_eq!(clamp_ctx(0), Some(NUM_CTX_RANGE.0));
    }

    #[test]
    fn parse_full_modelfile_parameters() {
        // Real Ollama /api/show format: `key<whitespace>value` per line,
        // no PARAMETER prefix.
        let raw = "temperature                    0.8\n\
                   top_p                          0.9\n\
                   top_k                          40\n\
                   num_ctx                        8192\n\
                   num_predict                    -1\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.temperature, Some(0.8));
        assert_eq!(params.top_p, Some(0.9));
        assert_eq!(params.top_k, Some(40));
        assert_eq!(params.num_ctx, Some(8192));
        // `num_predict -1` is Ollama's "unbounded" sentinel, now preserved
        // as-is since chat validation accepts it.
        assert_eq!(params.num_predict, Some(-1));
    }

    #[test]
    fn parse_partial_modelfile_parameters_only_some_keys() {
        let raw = "temperature                    0.5\n\
                   num_predict                    256\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.temperature, Some(0.5));
        assert!(params.top_p.is_none());
        assert!(params.top_k.is_none());
        assert!(params.num_ctx.is_none());
        assert_eq!(params.num_predict, Some(256));
    }

    #[test]
    fn parse_empty_string_returns_none() {
        assert!(parse_modelfile_parameters("").is_none());
    }

    #[test]
    fn parse_only_unknown_keys_returns_none() {
        // Real Ollama format: `stop "<|eot_id|>"` etc. — none of the five
        // tracked keys present → struct dropped entirely.
        let raw = "stop                           \"<|eot_id|>\"\n\
                   repeat_penalty                 1.1\n";
        assert!(parse_modelfile_parameters(raw).is_none());
    }

    #[test]
    fn parse_ignores_malformed_values() {
        let raw = "temperature                    notanumber\n\
                   top_k                          40\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        // temperature failed to parse → stays None; top_k parsed.
        assert!(params.temperature.is_none());
        assert_eq!(params.top_k, Some(40));
    }

    #[test]
    fn parse_ignores_non_parameter_lines() {
        // Lines that don't have a known key are ignored (comments, template,
        // etc.). Only the tracked key line survives.
        let raw = "# A Modelfile comment line\n\
                   TEMPLATE passed through\n\
                   temperature                    0.7\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.temperature, Some(0.7));
    }

    #[test]
    fn parse_tolerates_extra_whitespace_between_tokens() {
        // Ollama pads keys to a fixed width; tolerate arbitrary spacing.
        let raw = "temperature    0.9\n\
                   top_k\t64\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.temperature, Some(0.9));
        assert_eq!(params.top_k, Some(64));
    }

    #[test]
    fn parse_first_value_wins_ignore_dupes() {
        let raw = "temperature                    0.5\n\
                   temperature                    0.9\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.temperature, Some(0.5));
    }

    #[test]
    fn parse_quoted_stop_values_are_ignored() {
        // `stop` values are quoted strings that aren't tracked fields —
        // they should be silently ignored, along with unknown keys.
        let raw = "stop                           \"<|eot_id|>\"\n\
                   temperature                    0.7\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.temperature, Some(0.7));
    }

    #[test]
    fn parse_negative_num_predict_is_preserved() {
        // `num_predict -1` is Ollama's "unbounded" sentinel, now preserved
        // as `Some(-1)` since chat validation accepts it.
        let raw = "num_predict                    -1\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.num_predict, Some(-1));
    }

    #[test]
    fn parse_rejects_negative_num_ctx() {
        // num_ctx is u32; a negative parse should leave it None. Since no
        // other tracked field is present in this input, the whole struct is
        // dropped (None) per the "nothing parsed" rule.
        let raw = "num_ctx                        -1024\n";
        assert!(parse_modelfile_parameters(raw).is_none());
    }

    #[test]
    fn parse_rejects_negative_num_ctx_when_other_fields_present() {
        // num_ctx parse failure stays None, but the other tracked field
        // keeps the struct alive.
        let raw = "num_ctx                        -1024\n\
                   top_k                          40\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert!(params.num_ctx.is_none());
        assert_eq!(params.top_k, Some(40));
    }

    #[test]
    fn parse_negative_num_predict_when_other_fields_present() {
        // `num_predict -1` is preserved as `Some(-1)`, and the other tracked
        // field keeps the struct alive.
        let raw = "num_predict                    -1\n\
                   top_k                          40\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.num_predict, Some(-1));
        assert_eq!(params.top_k, Some(40));
    }

    #[test]
    fn parse_line_missing_value_is_ignored() {
        let raw = "temperature\n\
                   top_k                          40\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert!(params.temperature.is_none());
        assert_eq!(params.top_k, Some(40));
    }

    #[test]
    fn parse_line_missing_key_is_ignored() {
        // A blank or whitespace-only line has no tokens → skipped.
        let raw = "\n\
                   top_p                          0.9\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.top_p, Some(0.9));
    }

    #[test]
    fn parse_real_ollama_response_with_stop_directives() {
        // Simulates a real stock model (e.g. llama3.2) that only has `stop`
        // directives and no tracked sampling fields → returns None.
        let raw = "stop                           \"<|start_header_id|>\"\n\
                   stop                           \"<|end_header_id|>\"\n\
                   stop                           \"<|eot_id|>\"\n";
        assert!(parse_modelfile_parameters(raw).is_none());
    }

    #[test]
    fn parse_real_ollama_response_with_sampling_params() {
        // Simulates a custom model with sampling params alongside stop
        // directives (e.g. the `UncensoredAi/diddy` model).
        let raw = "stop                           \"<|im_end|>\"\n\
                   num_ctx                        4096\n\
                   temperature                    1.1\n\
                   top_p                          0.95\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.temperature, Some(1.1));
        assert_eq!(params.top_p, Some(0.95));
        assert_eq!(params.num_ctx, Some(4096));
        assert!(params.top_k.is_none());
        assert!(params.num_predict.is_none());
    }
}
