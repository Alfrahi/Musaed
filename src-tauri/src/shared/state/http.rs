//! Semaphores bounding Ollama traffic and the shared HTTP clients.

use std::sync::LazyLock;
use std::time::Duration;
use tokio::sync::Semaphore;

use super::super::shared_consts::*;

/// Semaphore limiting the number of concurrent chat streams.
pub static CONCURRENT_SEMAPHORE: LazyLock<Semaphore> =
    LazyLock::new(|| Semaphore::new(MAX_CONCURRENT_CHATS));

/// Global rate limiter for *all* Ollama-bound HTTP traffic.
pub static GLOBAL_SEMAPHORE: LazyLock<Semaphore> =
    LazyLock::new(|| Semaphore::new(MAX_CONCURRENT_REQUESTS));

/// General-purpose HTTP client used for long-lived operations (chat, pull).
pub static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .pool_max_idle_per_host(10)
        .build()
        .unwrap_or_else(|err| {
            tracing::warn!(
                "Failed to build configured HTTP client ({err}); falling back to default client"
            );
            reqwest::Client::new()
        })
});

/// Fast HTTP client for short-lived discovery / health-check calls.
pub static FAST_HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(FAST_TIMEOUT_SECS))
        .connect_timeout(Duration::from_secs(5))
        .pool_max_idle_per_host(4)
        .build()
        .unwrap_or_else(|err| {
            tracing::warn!(
                "Failed to build fast HTTP client ({err}); falling back to default client"
            );
            reqwest::Client::new()
        })
});

/// Acquires a permit from the global semaphore, returning a typed error on
/// closure so callers can map it to an `ApiResponse` without panicking.
pub async fn acquire_global_permit() -> Result<tokio::sync::SemaphorePermit<'static>, String> {
    GLOBAL_SEMAPHORE.acquire().await.map_err(|_| {
        "Global request limit reached — too many concurrent Ollama requests".to_string()
    })
}
