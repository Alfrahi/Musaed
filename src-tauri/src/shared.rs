//! Shared utilities, global state, and HTTP client used across command modules.

use crate::ollama_url::parse_ollama_base_url;
use crate::payloads::ApiResponse;
use crate::payloads::BackendError;
use dashmap::DashMap;
use std::sync::LazyLock;
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
pub const PULL_ABSOLUTE_TIMEOUT_SECS: u64 = 3600;
pub const INITIAL_REQUEST_TIMEOUT_SECS: u64 = 300;

// ====================== EVENT NAMES ======================

pub const EVENT_OLLAMA_TOKEN: &str = "ollama-token";
pub const EVENT_OLLAMA_ERROR: &str = "ollama-error";
pub const EVENT_PULL_PROGRESS: &str = "pull-progress";
pub const EVENT_PULL_ERROR: &str = "pull-error";

// ====================== GLOBAL STATE ======================

/// Map of request_id -> CancellationToken for aborting active chat streams.
pub static ABORT_HANDLES: LazyLock<DashMap<String, Arc<CancellationToken>>> = LazyLock::new(DashMap::new);

/// Map of model name -> CancellationToken for aborting active model pulls.
pub static PULL_ABORT_HANDLES: LazyLock<DashMap<String, Arc<CancellationToken>>> =
    LazyLock::new(DashMap::new);

/// Map of request_id -> Instant for deduplicating chat requests.
pub static REQUEST_CACHE: LazyLock<DashMap<String, Instant>> = LazyLock::new(DashMap::new);

/// Semaphore limiting the number of concurrent chat streams.
pub static CONCURRENT_SEMAPHORE: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(MAX_CONCURRENT_CHATS));

/// Global rate limiter for *all* Ollama-bound HTTP traffic.
pub static GLOBAL_SEMAPHORE: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(MAX_CONCURRENT_REQUESTS));

/// General-purpose HTTP client used for long-lived operations (chat, pull).
pub static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .pool_max_idle_per_host(10)
        .build()
        .expect("Failed to build HTTP client")
});

/// Fast HTTP client for short-lived discovery / health-check calls.
pub static FAST_HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_ollama_base_returns_error_response() {
        let resp: ApiResponse<String> = invalid_ollama_base("bad url");
        assert!(!resp.success);
        assert!(resp.data.is_none());
        let err = resp.error.unwrap();
        assert_eq!(err.code, "INVALID_URL");
        assert_eq!(err.message, "bad url");
    }

    #[test]
    fn test_ollama_endpoint_valid_url() {
        let result = ollama_endpoint("http://localhost:11434", "api/tags");
        assert!(result.is_ok());
        assert!(result.unwrap().ends_with("/api/tags"));
    }

    #[test]
    fn test_ollama_endpoint_rejects_public_ip() {
        let result = ollama_endpoint("http://8.8.8.8:11434", "api/tags");
        assert!(result.is_err());
    }

    #[test]
    fn test_ollama_endpoint_rejects_empty_url() {
        let result = ollama_endpoint("", "api/tags");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_acquire_global_permit_succeeds() {
        let result = acquire_global_permit().await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_constants_sanity() {
        assert_eq!(MAX_TOTAL_IMAGE_SIZE_BYTES, 10 * 1024 * 1024);
        assert!(FAST_TIMEOUT_SECS < DEFAULT_TIMEOUT_SECS);
        assert!(STREAM_IDLE_TIMEOUT_SECS < STREAM_ABSOLUTE_TIMEOUT_SECS);
        assert!(MAX_CONCURRENT_CHATS <= MAX_CONCURRENT_REQUESTS);
        assert!(!EVENT_OLLAMA_TOKEN.is_empty());
        assert!(!EVENT_OLLAMA_ERROR.is_empty());
        assert!(!EVENT_PULL_PROGRESS.is_empty());
        assert!(!EVENT_PULL_ERROR.is_empty());
    }

    #[test]
    fn test_event_name_constants_match_expected() {
        assert_eq!(EVENT_OLLAMA_TOKEN, "ollama-token");
        assert_eq!(EVENT_OLLAMA_ERROR, "ollama-error");
        assert_eq!(EVENT_PULL_PROGRESS, "pull-progress");
        assert_eq!(EVENT_PULL_ERROR, "pull-error");
    }

    #[tokio::test]
    async fn test_retry_succeeds_immediately() {
        use std::sync::atomic::{AtomicU32, Ordering};
        let calls = AtomicU32::new(0);
        let result: Result<&str, reqwest::Error> = retry_with_backoff(
            || {
                calls.fetch_add(1, Ordering::SeqCst);
                async { Ok("done") }
            },
            2,
            1,
        )
        .await;
        assert_eq!(result.unwrap(), "done");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_retry_returns_after_max_retries() {
        use std::sync::atomic::{AtomicU32, Ordering};
        let calls = AtomicU32::new(0);
        let result: Result<&str, reqwest::Error> = retry_with_backoff(
            || {
                let count = calls.fetch_add(1, Ordering::SeqCst);
                async move {
                    // Simulate a timeout error by constructing one from a builder
                    let client = reqwest::Client::new();
                    let res = client
                        .get("http://127.0.0.1:1")
                        .timeout(Duration::from_millis(1))
                        .send()
                        .await;
                    // If the actual request somehow succeeds, return it; otherwise return the error
                    drop(count);
                    res.map(|_| "should not happen")
                }
            },
            1,
            1,
        )
        .await;
        // We expect failure since port 1 is not listening
        assert!(result.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 2); // initial + 1 retry
    }
}
