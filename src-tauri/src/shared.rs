//! Shared utilities, global state, and HTTP client used across command modules.

use crate::ollama_url::parse_ollama_base_url;
use crate::payloads::ApiResponse;
use crate::payloads::BackendError;
use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

// ====================== CONSTANTS ======================

pub const MAX_TOTAL_IMAGE_SIZE_BYTES: usize = 10 * 1024 * 1024;
pub const PULL_PROGRESS_THROTTLE_MS: u64 = 400;
pub const MAX_CONCURRENT_CHATS: usize = 8;
/// Maximum number of in-flight requests to Ollama across *all* command types
/// (health checks, model discovery, chat, pull, etc.).
pub const MAX_CONCURRENT_REQUESTS: usize = 16;
/// Timeout for fast discovery / health-check requests (seconds).
pub const FAST_TIMEOUT_SECS: u64 = 10;
/// Timeout for the shared general-purpose client (seconds).
pub const DEFAULT_TIMEOUT_SECS: u64 = 120;
pub const STREAM_IDLE_TIMEOUT_SECS: u64 = 300;
pub const STREAM_ABSOLUTE_TIMEOUT_SECS: u64 = 900;
pub const INITIAL_REQUEST_TIMEOUT_SECS: u64 = 300;

// ====================== GLOBAL STATE ======================

/// Map of request_id -> CancellationToken for aborting active chat streams.
pub static ABORT_HANDLES: Lazy<DashMap<String, Arc<CancellationToken>>> = Lazy::new(DashMap::new);

/// Map of request_id -> Instant for deduplicating chat requests.
pub static REQUEST_CACHE: Lazy<DashMap<String, Instant>> = Lazy::new(DashMap::new);

/// Semaphore limiting the number of concurrent chat streams.
pub static CONCURRENT_SEMAPHORE: Lazy<Semaphore> = Lazy::new(|| Semaphore::new(MAX_CONCURRENT_CHATS));

/// Global rate limiter for *all* Ollama-bound HTTP traffic.
pub static GLOBAL_SEMAPHORE: Lazy<Semaphore> = Lazy::new(|| Semaphore::new(MAX_CONCURRENT_REQUESTS));

/// General-purpose HTTP client used for long-lived operations (chat, pull).
pub static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .pool_max_idle_per_host(10)
        .build()
        .expect("Failed to build HTTP client")
});

/// Fast HTTP client for short-lived discovery / health-check calls.
pub static FAST_HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(FAST_TIMEOUT_SECS))
        .connect_timeout(Duration::from_secs(5))
        .pool_max_idle_per_host(4)
        .build()
        .expect("Failed to build fast HTTP client")
});

// ====================== RATE-LIMIT HELPERS ======================

/// Acquires a permit from the global semaphore, returning a typed error on
/// closure so callers can map it to an `ApiResponse` without panicking.
pub async fn acquire_global_permit() -> Result<tokio::sync::SemaphorePermit<'static>, String> {
    GLOBAL_SEMAPHORE
        .acquire()
        .await
        .map_err(|_| "Global request limit reached — too many concurrent Ollama requests".to_string())
}

// ====================== URL HELPERS ======================

/// Builds an `ApiResponse` with an `INVALID_URL` error.
pub fn invalid_ollama_base<T>(msg: impl Into<String>) -> ApiResponse<T> {
    ApiResponse {
        success: false,
        data: None,
        error: Some(BackendError::new("INVALID_URL", msg.into())),
    }
}

/// Resolves an Ollama API path relative to the validated base URL.
pub fn ollama_endpoint(base_url: &str, path: &str) -> Result<String, String> {
    let base = parse_ollama_base_url(base_url)?;
    base.join(path)
        .map(|u| u.to_string())
        .map_err(|e| e.to_string())
}

// ====================== RETRY LOGIC ======================

fn is_retryable_error(err: &reqwest::Error) -> bool {
    err.is_timeout() || err.is_connect() || err.is_request()
}

/// Retries an async HTTP operation with exponential backoff and jitter.
pub async fn retry_with_backoff<F, Fut, T>(
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
                log::warn!(
                    "Request failed (attempt {}), retrying in {}ms: {}",
                    attempt + 1,
                    delay,
                    err
                );
                tokio::time::sleep(Duration::from_millis(delay)).await;
                backoff_ms = std::cmp::min(backoff_ms * 2, 30000);
            }
        }
    }
    unreachable!()
}
