//! Retry with exponential backoff + jitter for transient network errors.

use std::time::Duration;

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
                    tracing::info!("Request succeeded after {} retry(ies)", attempt);
                }
                return Ok(result);
            }
            Err(err) => {
                if !is_retryable_error(&err) {
                    tracing::error!("Request failed with non-retryable error: {}", err);
                    return Err(err);
                }
                if attempt == max_retries {
                    tracing::error!("Request failed after {} retries: {}", max_retries, err);
                    return Err(err);
                }
                let jitter = (rand::random::<f64>() * 0.1 * backoff_ms as f64) as u64;
                let delay = backoff_ms + jitter;
                tracing::warn!(
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
    // Total return path for `RetryError`: reqwest::Error has no public
    // constructor, so fall through to one final attempt and return its
    // result. This branch is unreachable in practice — the loop above runs
    // at least once and every iteration returns — but it keeps the function
    // total without panicking if the loop semantics ever change.
    f().await
}
