//! Shared utilities, global state, and HTTP client used across command modules.
//! Split into `state/` (registries), `retry`, `url`, and `shared_consts`;
//! this barrel re-exports everything so existing `crate::shared::X` imports
//! remain valid.

mod retry;
pub mod shared_consts;
pub mod state;
mod url;

pub use retry::*;
pub use shared_consts::*;
pub use state::*;
pub use url::*;
#[cfg(test)]
mod tests {
    use super::*;
    use crate::payloads::ApiResponse;
    use std::time::{Duration, Instant};

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
        const { assert!(FAST_TIMEOUT_SECS < DEFAULT_TIMEOUT_SECS) };
        const { assert!(STREAM_IDLE_TIMEOUT_SECS < STREAM_ABSOLUTE_TIMEOUT_SECS) };
        const { assert!(MAX_CONCURRENT_CHATS <= MAX_CONCURRENT_REQUESTS) };
        const { assert!(MAX_REQUEST_CACHE_SIZE >= MAX_CONCURRENT_REQUESTS) };
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
    async fn test_evict_stale_requests_removes_expired() {
        let _guard = test_cache_lock().await;
        clear_request_cache();

        // Insert an entry, wait briefly, then evict with a very short TTL.
        // The entry should be removed because it's older than 1ms.
        REQUEST_CACHE.insert("stale-req".to_string(), Instant::now());
        // Tiny sleep so the entry is genuinely older than 0ms.
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        REQUEST_CACHE.insert("fresh-req".to_string(), Instant::now());

        let evicted = evict_older_than(Duration::from_millis(1));
        assert_eq!(evicted, 1);
        assert!(
            REQUEST_CACHE.get("stale-req").is_none(),
            "stale entry should be removed"
        );
        assert!(
            REQUEST_CACHE.get("fresh-req").is_some(),
            "fresh entry should remain"
        );

        clear_request_cache();
    }

    #[tokio::test]
    async fn test_evict_stale_requests_empty_cache() {
        let _guard = test_cache_lock().await;
        clear_request_cache();

        let evicted = evict_older_than(Duration::from_secs(0));
        assert_eq!(evicted, 0);
    }

    #[tokio::test]
    async fn test_evict_stale_requests_all_fresh() {
        let _guard = test_cache_lock().await;
        clear_request_cache();

        REQUEST_CACHE.insert("r1".to_string(), Instant::now());
        REQUEST_CACHE.insert("r2".to_string(), Instant::now());

        // 1-hour TTL — both entries are fresh
        let evicted = evict_older_than(Duration::from_secs(3600));
        assert_eq!(evicted, 0);
        assert_eq!(REQUEST_CACHE.len(), 2);

        clear_request_cache();
    }

    #[tokio::test]
    async fn test_evict_stale_requests_all_stale() {
        let _guard = test_cache_lock().await;
        clear_request_cache();

        REQUEST_CACHE.insert("s1".to_string(), Instant::now());
        REQUEST_CACHE.insert("s2".to_string(), Instant::now());

        // Tiny sleep so both entries are older than 0ms
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;

        let evicted = evict_older_than(Duration::from_millis(1));
        assert_eq!(evicted, 2);
        assert!(REQUEST_CACHE.is_empty());

        clear_request_cache();
    }

    #[test]
    fn test_ttl_is_greater_than_stream_timeout() {
        // Ensure TTL never evicts legitimate in-flight streams
        const {
            assert!(
                REQUEST_CACHE_TTL_SECS > STREAM_ABSOLUTE_TIMEOUT_SECS,
                "REQUEST_CACHE_TTL_SECS must exceed STREAM_ABSOLUTE_TIMEOUT_SECS to avoid evicting live streams"
            )
        };
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
                    let _ = count;
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

    // ---- Bounded cache tests ----

    #[tokio::test]
    async fn test_request_cache_try_insert_new_key() {
        let _guard = test_cache_lock().await;
        clear_request_cache();
        let key = "bounded-new".to_string();
        assert!(request_cache_try_insert(key.clone()));
        assert!(REQUEST_CACHE.get(&key).is_some());
        clear_request_cache();
    }

    #[tokio::test]
    async fn test_request_cache_try_insert_rejects_duplicate() {
        let _guard = test_cache_lock().await;
        clear_request_cache();
        let key = "bounded-dup".to_string();
        assert!(request_cache_try_insert(key.clone()));
        assert!(
            !request_cache_try_insert(key.clone()),
            "duplicate should be rejected"
        );
        clear_request_cache();
    }

    #[tokio::test]
    async fn test_request_cache_size_bound_evicts_oldest() {
        let _guard = test_cache_lock().await;
        clear_request_cache();
        // Fill cache to capacity. The first entry should be evicted when one
        // more is inserted.
        let mut keys: Vec<String> = Vec::with_capacity(MAX_REQUEST_CACHE_SIZE + 1);
        for i in 0..MAX_REQUEST_CACHE_SIZE {
            let key = format!("capacity-{}", i);
            assert!(request_cache_try_insert(key.clone()));
            keys.push(key);
        }

        assert_eq!(
            REQUEST_CACHE.len(),
            MAX_REQUEST_CACHE_SIZE,
            "cache should be at capacity"
        );

        // The first key is the oldest and should be evicted by the next insert.
        let overflow_key = "capacity-overflow".to_string();
        assert!(request_cache_try_insert(overflow_key.clone()));
        assert!(
            REQUEST_CACHE.get("capacity-0").is_none(),
            "oldest entry should have been evicted"
        );
        assert!(
            REQUEST_CACHE.get(&overflow_key).is_some(),
            "new entry should be present"
        );
        assert_eq!(REQUEST_CACHE.len(), MAX_REQUEST_CACHE_SIZE);

        clear_request_cache();
    }
}
