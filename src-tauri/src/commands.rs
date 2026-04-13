use tauri::{AppHandle, Emitter, Manager, Runtime};
use crate::ollama_url::parse_ollama_base_url;
use crate::payloads::{ApiResponse, BackendError, ChatMessage, ChatOptions, OllamaModel, OllamaToken, PullProgress, PullStreamError, OllamaHealth, ModelValidation};
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration, Instant};
use dashmap::{DashMap, mapref::entry::Entry};
use once_cell::sync::Lazy;
use futures::StreamExt;
use tokio_util::codec::{FramedRead, LinesCodec};
use tokio_util::sync::CancellationToken;
use std::path::PathBuf;
use std::fs::OpenOptions;
use std::io::Write;
use scopeguard::defer;
use tokio::sync::Semaphore;
use tokio::time;

// ====================== CONSTANTS ======================
const MAX_TOTAL_IMAGE_SIZE_BYTES: usize = 10 * 1024 * 1024;
const PULL_PROGRESS_THROTTLE_MS: u64 = 400;
const MAX_CONCURRENT_CHATS: usize = 8;
const STREAM_IDLE_TIMEOUT_SECS: u64 = 60;
const STREAM_ABSOLUTE_TIMEOUT_SECS: u64 = 300;
const INITIAL_REQUEST_TIMEOUT_SECS: u64 = 30;

// Global state
static ABORT_HANDLES: Lazy<DashMap<String, Arc<CancellationToken>>> = Lazy::new(DashMap::new);
static REQUEST_CACHE: Lazy<DashMap<String, Instant>> = Lazy::new(DashMap::new);
static CONCURRENT_SEMAPHORE: Lazy<Semaphore> = Lazy::new(|| Semaphore::new(MAX_CONCURRENT_CHATS));

static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
    .timeout(Duration::from_secs(120))
    .pool_max_idle_per_host(10)
    .build()
    .expect("Failed to build HTTP client")
});

fn invalid_ollama_base<T>(msg: impl Into<String>) -> ApiResponse<T> {
    ApiResponse {
        success: false,
        data: None,
        error: Some(BackendError::new("INVALID_URL", msg.into())),
    }
}

fn ollama_endpoint(base_url: &str, path: &str) -> Result<String, String> {
    let base = parse_ollama_base_url(base_url)?;
    base.join(path)
    .map(|u| u.to_string())
    .map_err(|e| e.to_string())
}

fn is_retryable_error(err: &reqwest::Error) -> bool {
    err.is_timeout() || err.is_connect() || err.is_request()
}

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
                let jitter = (rand::random::<f64>() * 0.1 * backoff_ms as f64) as u64;
                let delay = backoff_ms + jitter;
                log::warn!("Request failed (attempt {}), retrying in {}ms: {}", attempt + 1, delay, err);
                tokio::time::sleep(Duration::from_millis(delay)).await;
                backoff_ms = std::cmp::min(backoff_ms * 2, 30000);
            }
        }
    }
    unreachable!()
}

fn get_log_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let log_dir = data_dir.join("musaed").join("logs");
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    Ok(log_dir.join("musaed.log"))
}

fn append_log_entry<R: Runtime>(app: AppHandle<R>, entry: String) {
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(path) = get_log_path(&app) {
            if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
                let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
                let _ = writeln!(file, "[{}] {}", timestamp, entry);
            }
        }
    });
}

// ==================== LOGGING COMMANDS ====================

#[tauri::command]
pub async fn append_to_log<R: Runtime>(app: AppHandle<R>, entry: String) -> ApiResponse<()> {
    log::info!("Log entry: {}", entry);
    append_log_entry(app, entry);
    ApiResponse { success: true, data: Some(()), error: None }
}

#[tauri::command]
pub async fn clear_logs<R: Runtime>(app: AppHandle<R>) -> ApiResponse<()> {
    log::info!("Clearing logs");
    match get_log_path(&app) {
        Ok(path) => {
            if path.exists() {
                let _ = std::fs::write(&path, b"");
            }
        }
        Err(e) => log::error!("Failed to resolve log path: {}", e),
    }
    ApiResponse { success: true, data: Some(()), error: None }
}

// ==================== OLLAMA MODELS ====================

#[tauri::command]
pub async fn get_ollama_models(base_url: String) -> ApiResponse<Vec<OllamaModel>> {
    log::info!("Fetching Ollama models from: {}", base_url);
    let start = std::time::Instant::now();

    let url = match ollama_endpoint(&base_url, "api/tags") {
        Ok(u) => u,
        Err(msg) => return invalid_ollama_base(msg),
    };

    match retry_with_backoff(|| {
        let url = url.clone();
        async move { HTTP_CLIENT.get(&url).send().await }
    }, 2, 500).await {
        Ok(resp) => {
            match resp.json::<serde_json::Value>().await {
                Ok(json) => {
                    let models: Vec<OllamaModel> = serde_json::from_value(
                        json.get("models").cloned().unwrap_or_else(|| json!([]))
                    ).unwrap_or_default();
                    log::info!("Successfully fetched {} models in {:?}", models.len(), start.elapsed());
                    ApiResponse { success: true, data: Some(models), error: None }
                }
                Err(e) => {
                    log::error!("Failed to parse models response: {}", e);
                    ApiResponse {
                        success: false,
                        data: None,
                        error: Some(BackendError::new("INVALID_RESPONSE", e.to_string())
                        .with_context("Failed to parse JSON response from Ollama".to_string())),
                    }
                }
            }
        }
        Err(e) => {
            log::error!("Network error fetching models: {}", e);
            ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new("NETWORK_ERROR", e.to_string())
                .with_context("Failed to connect to Ollama server".to_string())
                .retryable()),
            }
        }
    }
}

// ==================== CHAT OPERATIONS (Fixed - Single Token Emission) ====================

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
                format!("Total image size exceeds {} MiB limit", MAX_TOTAL_IMAGE_SIZE_BYTES / 1024 / 1024),
            )),
        };
    }

    let url = match ollama_endpoint(&base_url, "api/chat") {
        Ok(u) => u,
        Err(msg) => return invalid_ollama_base(msg),
    };

    // Atomic duplicate check
    match REQUEST_CACHE.entry(request_id.clone()) {
        Entry::Occupied(_) => {
            log::warn!("Duplicate request detected: {}", request_id);
            return ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new("DUPLICATE_REQUEST", "Request already in progress")
                .with_request_id(request_id)),
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
                error: Some(BackendError::new("RATE_LIMITED", "Too many concurrent requests")),
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
    let response = match retry_with_backoff(|| {
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
    }, 2, 500).await {
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
        let _permit = permit;

        defer! {
            ABORT_HANDLES.remove(&request_id_clone);
            REQUEST_CACHE.remove(&request_id_clone);
        }

        log::debug!("Starting streaming for request_id: {}", request_id_clone);

        let stream_start = Instant::now();
        let mut token_count = 0;

        let stream_result = time::timeout(
            Duration::from_secs(STREAM_ABSOLUTE_TIMEOUT_SECS),
                                          async {
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
                                                          log::info!("Stream cancelled for request_id: {}", request_id_clone);
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
                                                                              let _ = app_clone.emit("ollama-error",
                                                                                                     &BackendError::new("OLLAMA_ERROR", msg)
                                                                                                     .with_request_id(request_id_clone.clone()));
                                                                              break;
                                                                          }

                                                                          if let Some(obj) = token_data.as_object_mut() {
                                                                              obj.insert("requestId".to_string(), json!(request_id_clone));
                                                                          }

                                                                          match serde_json::from_value::<OllamaToken>(token_data) {
                                                                              Ok(token) => {
                                                                                  token_count += 1;
                                                                                  let _ = app_clone.emit("ollama-token", &token);  // ← Single token emission
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
                                              log::warn!("Idle timeout on stream for request_id: {}", request_id_clone);
                                              let _ = app_clone.emit("ollama-error",
                                                                     &BackendError::new("STREAM_IDLE_TIMEOUT", "No data received for too long")
                                                                     .with_request_id(request_id_clone.clone()));
                                              break;
                                          }
                                                          }
                                                      }
                                                  }
                                              }
                                          }
        ).await;

        if stream_result.is_err() {
            log::warn!("Chat stream timed out after {} seconds for request_id: {}", STREAM_ABSOLUTE_TIMEOUT_SECS, request_id_clone);
            let _ = app_clone.emit("ollama-error",
                                   &BackendError::new("STREAM_TIMEOUT", "Chat stream timed out")
                                   .with_request_id(request_id_clone.clone()));
        }

        log::info!(
            "Stream completed for request_id: {} (tokens: {}, duration: {:?})",
                   request_id_clone, token_count, stream_start.elapsed()
        );
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

// ==================== MODEL MANAGEMENT, HEALTH, FILE OPS ====================
// (All other functions remain exactly as in your latest version)

#[tauri::command]
pub async fn validate_model(base_url: String, model_name: String) -> ApiResponse<ModelValidation> {
    log::info!("Validating model: {}", model_name);

    let url = match ollama_endpoint(&base_url, "api/show") {
        Ok(u) => u,
        Err(msg) => return invalid_ollama_base(msg),
    };

    match HTTP_CLIENT
    .post(&url)
    .json(&json!({ "name": model_name }))
    .send()
    .await
    {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<serde_json::Value>().await {
                Ok(json) => {
                    let details = serde_json::from_value(json.get("details").cloned().unwrap_or_default()).ok();
                    log::info!("Model {} validation successful", model_name);
                    ApiResponse {
                        success: true,
                        data: Some(ModelValidation { is_valid: true, model_name: model_name.clone(), details }),
                        error: None,
                    }
                }
                Err(e) => {
                    log::error!("Failed to parse model details: {}", e);
                    ApiResponse {
                        success: false,
                        data: Some(ModelValidation { is_valid: false, model_name, details: None }),
                        error: Some(BackendError::new("PARSE_ERROR", e.to_string())),
                    }
                }
            }
        }
        Ok(_) => {
            log::warn!("Model validation failed for {}", model_name);
            ApiResponse {
                success: false,
                data: Some(ModelValidation { is_valid: false, model_name, details: None }),
                error: Some(BackendError::new("MODEL_NOT_FOUND", "Model doesn't exist on Ollama server")),
            }
        }
        Err(e) => {
            log::error!("Network error validating model: {}", e);
            ApiResponse {
                success: false,
                data: Some(ModelValidation { is_valid: false, model_name, details: None }),
                error: Some(BackendError::new("NETWORK_ERROR", e.to_string())
                .with_context("Failed to connect to Ollama server".to_string())
                .retryable()),
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

    let app_clone = app.clone();
    let name_clone = name.clone();

    tokio::spawn(async move {
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
                    log::error!("Pull request failed for model {}: HTTP {} — {}", name_clone, status, body);
                    let _ = app_clone.emit("pull-error", &PullStreamError {
                        name: name_clone.clone(),
                                           error: format!("HTTP {}: {}", status, body.chars().take(500).collect::<String>()),
                                           duration: pull_start.elapsed().as_secs(),
                    });
                    return;
                }

                log::info!("Pull request accepted for model: {}", name_clone);

                let stream = response.bytes_stream();
                let mut lines = FramedRead::new(
                    tokio_util::io::StreamReader::new(
                        stream.map(|res| res.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))),
                    ),
                    LinesCodec::new(),
                );

                while let Some(Ok(line)) = lines.next().await {
                    if let Ok(mut progress_val) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(err) = progress_val.get("error") {
                            let msg = err.as_str().map(str::to_owned).unwrap_or_else(|| err.to_string());
                            log::error!("Pull stream error for {}: {}", name_clone, msg);
                            let _ = app_clone.emit("pull-error", &PullStreamError {
                                name: name_clone.clone(),
                                                   error: msg,
                                                   duration: pull_start.elapsed().as_secs(),
                            });
                            return;
                        }

                        if let Some(obj) = progress_val.as_object_mut() {
                            obj.insert("name".to_string(), json!(name_clone));
                        }

                        if let Ok(p) = serde_json::from_value::<PullProgress>(progress_val) {
                            if last_emit.elapsed().as_millis() as u64 > PULL_PROGRESS_THROTTLE_MS || p.status.contains("success") {
                                let _ = app_clone.emit("pull-progress", &p);
                                last_emit = std::time::Instant::now();
                            }
                        }
                    }
                }

                log::info!("Model pull completed: {} (duration: {:?})", name_clone, pull_start.elapsed());
            }
            Err(e) => {
                log::error!("Pull request failed for model {}: {}", name_clone, e);
                let _ = app_clone.emit("pull-error", &PullStreamError {
                    name: name_clone.clone(),
                                       error: e.to_string(),
                                       duration: pull_start.elapsed().as_secs(),
                });
            }
        }
    });

    ApiResponse { success: true, data: Some(()), error: None }
}

#[tauri::command]
pub async fn delete_model(base_url: String, name: String) -> ApiResponse<bool> {
    log::info!("Deleting model: {}", name);

    let url = match ollama_endpoint(&base_url, "api/delete") {
        Ok(u) => u,
        Err(msg) => return invalid_ollama_base(msg),
    };

    match HTTP_CLIENT.delete(&url).json(&json!({ "name": name })).send().await {
        Ok(resp) if resp.status().is_success() => {
            log::info!("Model deleted successfully: {}", name);
            ApiResponse { success: true, data: Some(true), error: None }
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
                error: Some(BackendError::new("NETWORK_ERROR", e.to_string())
                .with_context("Failed to connect to Ollama server".to_string())
                .retryable()),
            }
        }
    }
}

#[tauri::command]
pub async fn check_ollama_health(base_url: String) -> ApiResponse<OllamaHealth> {
    log::info!("Checking Ollama health: {}", base_url);
    let start = std::time::Instant::now();

    let url = match ollama_endpoint(&base_url, "api/tags") {
        Ok(u) => u,
        Err(msg) => return invalid_ollama_base(msg),
    };

    match time::timeout(Duration::from_secs(10), HTTP_CLIENT.get(&url).send()).await {
        Ok(Ok(_)) => {
            let response_time = start.elapsed().as_millis();
            log::info!("Ollama health check passed ({}ms)", response_time);
            ApiResponse {
                success: true,
                data: Some(OllamaHealth { is_running: true, version: None, response_time_ms: response_time }),
                error: None,
            }
        }
        Ok(Err(e)) => {
            log::warn!("Ollama health check failed: {}", e);
            ApiResponse {
                success: false,
                data: Some(OllamaHealth { is_running: false, version: None, response_time_ms: start.elapsed().as_millis() }),
                error: Some(BackendError::new("HEALTH_CHECK_FAILED", e.to_string()).retryable()),
            }
        }
        Err(_) => {
            log::warn!("Ollama health check timed out");
            ApiResponse {
                success: false,
                data: Some(OllamaHealth { is_running: false, version: None, response_time_ms: start.elapsed().as_millis() }),
                error: Some(BackendError::new("HEALTH_CHECK_TIMEOUT", "Request timed out").retryable()),
            }
        }
    }
}

#[tauri::command]
pub async fn select_and_extract_files() -> ApiResponse<Vec<String>> {
    log::debug!("select_and_extract_files called (placeholder)");
    ApiResponse { success: true, data: Some(vec![]), error: None }
}

#[tauri::command]
pub async fn select_and_extract_folder() -> ApiResponse<Vec<String>> {
    log::debug!("select_and_extract_folder called (placeholder)");
    ApiResponse { success: true, data: Some(vec![]), error: None }
}
