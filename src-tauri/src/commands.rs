use tauri::{AppHandle, Emitter, Runtime};
use crate::payloads::{ApiResponse, BackendError, ChatMessage, ChatOptions, OllamaModel, OllamaToken, PullProgress, OllamaHealth, ModelValidation};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use dashmap::DashMap;
use once_cell::sync::Lazy;
use futures::StreamExt;
use tokio_util::codec::{FramedRead, LinesCodec};
use tokio_util::sync::CancellationToken;

// Global state management
static ABORT_HANDLES: Lazy<DashMap<String, Arc<CancellationToken>>> = Lazy::new(DashMap::new);
static REQUEST_CACHE: Lazy<DashMap<String, bool>> = Lazy::new(DashMap::new);

// HTTP Client with connection pooling
fn get_http_client() -> reqwest::Client {
    reqwest::Client::builder()
    .timeout(Duration::from_secs(120))
    .pool_max_idle_per_host(10)
    .build()
    .unwrap_or_else(|_| reqwest::Client::new())
}

/// Determine if an error is retryable
fn is_retryable_error(err: &reqwest::Error) -> bool {
    err.is_timeout()
    || err.is_connect()
    || err.is_request()
}

/// Simple retry helper with exponential backoff
async fn retry_with_backoff<F, Fut, T>(
    mut f: F,
    max_retries: u32,
    initial_backoff_ms: u64,
) -> Result<T, reqwest::Error>
where
F: FnMut() -> Fut,
Fut: std::future::Future<Output = Result<T, reqwest::Error>>,
{
    let mut backoff_ms = initial_backoff_ms;

    for attempt in 0..=max_retries {
        match f().await {
            Ok(result) => {
                if attempt > 0 {
                    log::info!("Request succeeded after {} retry(ies)", attempt);
                }
                return Ok(result);
            }
            Err(err) => {
                if !is_retryable_error(&err) {
                    log::error!("Request failed with non-retryable error: {}", err);
                    return Err(err);
                }

                if attempt == max_retries {
                    log::error!("Request failed after {} retries: {}", max_retries, err);
                    return Err(err);
                }

                // Add jitter to avoid thundering herd
                let jitter = (rand::random::<f64>() * 0.1 * backoff_ms as f64) as u64;
                let delay = backoff_ms + jitter;

                log::warn!(
                    "Request failed (attempt {}), retrying in {}ms: {}",
                           attempt + 1,
                           delay,
                           err
                );

                tokio::time::sleep(Duration::from_millis(delay)).await;
                backoff_ms = std::cmp::min(backoff_ms * 2, 30000); // Max 30 seconds
            }
        }
    }

    unreachable!()
}

// ==================== OLLAMA MODELS ====================

#[tauri::command]
pub async fn get_ollama_models(base_url: String) -> ApiResponse<Vec<OllamaModel>> {
    log::info!("Fetching Ollama models from: {}", base_url);
    let start = std::time::Instant::now();

    let client = get_http_client();
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));

    match retry_with_backoff(
        || {
            let client = client.clone();
            let url = url.clone();
            async move {
                client.get(&url).send().await
            }
        },
        2,
        500,
    )
    .await
    {
        Ok(resp) => {
            match resp.json::<serde_json::Value>().await {
                Ok(json) => {
                    let models: Vec<OllamaModel> = serde_json::from_value(
                        json.get("models").cloned().unwrap_or_else(|| json!([]))
                    ).unwrap_or_default();

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
                            .with_context("Failed to parse JSON response from Ollama".to_string())
                        ),
                    }
                }
            }
        }
        Err(e) => {
            log::error!("Network error fetching models: {}", e);
            ApiResponse {
                success: false,
                data: None,
                error: Some(
                    BackendError::new("NETWORK_ERROR", e.to_string())
                    .with_context("Failed to connect to Ollama server".to_string())
                    .retryable()
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
    log::info!("Starting chat request: request_id={}, model={}", request_id, model);
    let start = std::time::Instant::now();

    // Duplicate request detection
    if REQUEST_CACHE.contains_key(&request_id) {
        log::warn!("Duplicate request detected: {}", request_id);
        return ApiResponse {
            success: false,
            data: None,
            error: Some(
                BackendError::new("DUPLICATE_REQUEST", "Request already in progress")
                .with_request_id(request_id)
            ),
        };
    }

    REQUEST_CACHE.insert(request_id.clone(), true);

    let cancel_token = Arc::new(CancellationToken::new());
    ABORT_HANDLES.insert(request_id.clone(), cancel_token.clone());

    let client = get_http_client();
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));

    let payload = json!({
        "model": model,
        "messages": messages,
        "options": options,
        "stream": true
    });

    // Initial request to verify connection
    let response = match client.post(&url).json(&payload).send().await {
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
                    .with_context("Failed to connect to Ollama chat endpoint".to_string())
                    .retryable()
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
                .with_context(format!("HTTP Status: {}", status))
            ),
        };
    }

    let request_id_clone = request_id.clone();
    let app_clone = app.clone();

    // Spawn background task for NDJSON streaming
    tokio::spawn(async move {
        log::debug!("Starting streaming for request_id: {}", request_id_clone);
        let stream_start = std::time::Instant::now();
        let mut token_count = 0;

        let stream = response.bytes_stream();
        let mut lines = FramedRead::new(
            tokio_util::io::StreamReader::new(
                stream.map(|res| {
                    res.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
                })
            ),
            LinesCodec::new(),
        );

        while let Some(Ok(line)) = lines.next().await {
            if cancel_token.is_cancelled() {
                log::info!("Stream cancelled for request_id: {}", request_id_clone);
                break;
            }

            if line.trim().is_empty() {
                continue;
            }

            match serde_json::from_str::<serde_json::Value>(&line) {
                Ok(mut token_data) => {
                    if let Some(obj) = token_data.as_object_mut() {
                        obj.insert("requestId".to_string(), json!(request_id_clone));
                    }

                    match serde_json::from_value::<OllamaToken>(token_data) {
                        Ok(token) => {
                            token_count += 1;
                            if let Err(e) = app_clone.emit("ollama-token", &token) {
                                log::warn!("Failed to emit token: {:?}", e);
                            }
                        }
                        Err(e) => {
                            log::warn!("Failed to parse token: {}", e);
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Failed to parse JSON line: {}", e);
                }
            }
        }

        log::info!(
            "Stream completed for request_id: {} (tokens: {}, duration: {:?})",
                   request_id_clone,
                   token_count,
                   stream_start.elapsed()
        );

        ABORT_HANDLES.remove(&request_id_clone);
        REQUEST_CACHE.remove(&request_id_clone);
    });

    log::info!("Chat request initiated successfully in {:?}", start.elapsed());
    ApiResponse {
        success: true,
        data: Some(true),
        error: None,
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
pub async fn validate_model(base_url: String, model_name: String) -> ApiResponse<ModelValidation> {
    log::info!("Validating model: {}", model_name);

    let client = get_http_client();
    let url = format!("{}/api/show", base_url.trim_end_matches('/'));

    match client
    .post(&url)
    .json(&json!({ "name": model_name }))
    .send()
    .await
    {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<serde_json::Value>().await {
                Ok(json) => {
                    let details = serde_json::from_value(json.get("details").cloned().unwrap_or_default())
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
        Ok(resp) => {
            log::warn!("Model validation failed with status {}: {}", resp.status(), model_name);
            ApiResponse {
                success: false,
                data: Some(ModelValidation {
                    is_valid: false,
                    model_name,
                    details: None,
                }),
                error: Some(BackendError::new("MODEL_NOT_FOUND", "Model doesn't exist on Ollama server")),
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
                    .retryable()
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

    let client = get_http_client();
    let url = format!("{}/api/pull", base_url.trim_end_matches('/'));
    let app_clone = app.clone();
    let name_clone = name.clone();

    tokio::spawn(async move {
        let pull_start = std::time::Instant::now();

        match client
        .post(&url)
        .json(&json!({ "name": name_clone, "stream": true }))
        .send()
        .await
        {
            Ok(response) => {
                log::info!("Pull request accepted for model: {}", name_clone);

                let stream = response.bytes_stream();
                let mut lines = FramedRead::new(
                    tokio_util::io::StreamReader::new(
                        stream.map(|res| {
                            res.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
                        })
                    ),
                    LinesCodec::new(),
                );

                let mut last_progress_log = std::time::Instant::now();

                while let Some(Ok(line)) = lines.next().await {
                    if let Ok(mut progress_val) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(obj) = progress_val.as_object_mut() {
                            obj.insert("name".to_string(), json!(name_clone));
                        }

                        if let Ok(p) = serde_json::from_value::<PullProgress>(progress_val) {
                            // Log progress periodically
                            if last_progress_log.elapsed() > Duration::from_secs(5) {
                                log::debug!(
                                    "Pull progress for {}: status={}, completed={:?}",
                                    name_clone,
                                    p.status,
                                    p.completed
                                );
                                last_progress_log = std::time::Instant::now();
                            }

                            if let Err(e) = app_clone.emit("pull-progress", &p) {
                                log::warn!("Failed to emit pull progress: {:?}", e);
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
                    json!({
                        "name": name_clone,
                        "error": e.to_string(),
                          "duration": pull_start.elapsed().as_secs()
                    }),
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

    let client = get_http_client();
    let url = format!("{}/api/delete", base_url.trim_end_matches('/'));

    match client
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
                    .retryable()
                ),
            }
        }
    }
}

// ==================== HEALTH CHECK ====================

#[tauri::command]
pub async fn check_ollama_health(base_url: String) -> ApiResponse<OllamaHealth> {
    log::info!("Checking Ollama health: {}", base_url);
    let start = std::time::Instant::now();

    let client = get_http_client();
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));

    match tokio::time::timeout(Duration::from_secs(10), client.get(&url).send()).await {
        Ok(Ok(_)) => {
            let response_time = start.elapsed().as_millis();
            log::info!("Ollama health check passed ({}ms)", response_time);
            ApiResponse {
                success: true,
                data: Some(OllamaHealth {
                    is_running: true,
                    version: None,
                    response_time_ms: response_time,
                }),
                error: None,
            }
        }
        Ok(Err(e)) => {
            log::warn!("Ollama health check failed: {}", e);
            ApiResponse {
                success: false,
                data: Some(OllamaHealth {
                    is_running: false,
                    version: None,
                    response_time_ms: start.elapsed().as_millis(),
                }),
                error: Some(BackendError::new("HEALTH_CHECK_FAILED", e.to_string()).retryable()),
            }
        }
        Err(_) => {
            log::warn!("Ollama health check timed out");
            ApiResponse {
                success: false,
                data: Some(OllamaHealth {
                    is_running: false,
                    version: None,
                    response_time_ms: start.elapsed().as_millis(),
                }),
                error: Some(BackendError::new("HEALTH_CHECK_TIMEOUT", "Request timed out").retryable()),
            }
        }
    }
}

// ==================== FILE OPERATIONS ====================

#[tauri::command]
pub async fn append_to_log(entry: String) -> ApiResponse<()> {
    log::info!("Log entry: {}", entry);
    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

#[tauri::command]
pub async fn clear_logs() -> ApiResponse<()> {
    log::info!("Clearing logs");
    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

#[tauri::command]
pub async fn select_and_extract_files() -> ApiResponse<Vec<String>> {
    log::debug!("Extracting files");
    ApiResponse {
        success: true,
        data: Some(vec![]),
        error: None,
    }
}

#[tauri::command]
pub async fn select_and_extract_folder() -> ApiResponse<Vec<String>> {
    log::debug!("Extracting folder");
    ApiResponse {
        success: true,
        data: Some(vec![]),
        error: None,
    }
}
