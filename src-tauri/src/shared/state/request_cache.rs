//! Request-dedup cache: maps `request_id` -> insertion `Instant`, with
//! TTL eviction, capacity bounds, and a background sweep task.

use dashmap::DashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use super::super::shared_consts::*;
use super::abort_registry::sweep_stale_abort_handles;

/// Map of request_id -> Instant for deduplicating chat requests.
pub static REQUEST_CACHE: LazyLock<DashMap<String, Instant>> = LazyLock::new(DashMap::new);

// ====================== CACHE EVICTION ======================

/// Evicts the single oldest entry from [`REQUEST_CACHE`], based on insertion timestamp.
/// Returns `true` if an entry was evicted, `false` if the cache was empty.
fn evict_oldest_request_entry() -> bool {
    let oldest = REQUEST_CACHE
        .iter()
        .min_by_key(|e| *e.value())
        .map(|e| e.key().clone());

    match oldest {
        Some(key) => {
            REQUEST_CACHE.remove(&key);
            tracing::warn!(
                "Request cache at capacity ({}), evicted oldest entry: {}",
                MAX_REQUEST_CACHE_SIZE,
                key
            );
            true
        }
        None => false,
    }
}

/// Attempts to insert a request ID into [`REQUEST_CACHE`].
///
/// Returns `true` if the insertion succeeded (new request), or `false` if the
/// key was already present (duplicate request). If the cache is at
/// [`MAX_REQUEST_CACHE_SIZE`], the oldest entry is evicted before insertion.
pub fn request_cache_try_insert(request_id: String) -> bool {
    use dashmap::mapref::entry::Entry;

    // Pre-emptively evict if at capacity (before acquiring entry lock).
    if REQUEST_CACHE.len() >= MAX_REQUEST_CACHE_SIZE {
        evict_oldest_request_entry();
    }

    match REQUEST_CACHE.entry(request_id) {
        Entry::Occupied(_) => false,
        Entry::Vacant(e) => {
            e.insert(Instant::now());
            true
        }
    }
}

/// Removes all entries from `REQUEST_CACHE` whose age exceeds `REQUEST_CACHE_TTL_SECS`.
/// Returns the number of entries evicted (useful for diagnostics / logging).
pub fn evict_stale_requests() -> usize {
    evict_older_than(Duration::from_secs(REQUEST_CACHE_TTL_SECS))
}

/// Removes entries older than the given TTL, using [`Instant::now`] as reference.
/// Exposed for tests that need a shorter TTL than the production default.
pub fn evict_older_than(ttl: Duration) -> usize {
    let now = Instant::now();
    let before = REQUEST_CACHE.len();
    let cutoff = now.checked_sub(ttl);
    match cutoff {
        Some(c) => REQUEST_CACHE.retain(|_, inserted_at| *inserted_at > c),
        None => {
            // TTL exceeds system uptime — nothing can be stale yet, so retain all.
        }
    }
    before - REQUEST_CACHE.len()
}

/// Spawns a background task that periodically sweeps `REQUEST_CACHE` for stale entries.
/// Must be called from within a Tokio runtime context (e.g. from an async setup or
/// via `tauri::async_runtime::spawn`).
pub fn spawn_cache_eviction_task() {
    tauri::async_runtime::spawn(async {
        let mut interval =
            tokio::time::interval(Duration::from_secs(REQUEST_CACHE_EVICTION_INTERVAL_SECS));
        loop {
            interval.tick().await;
            let evicted = evict_stale_requests();
            let len = REQUEST_CACHE.len();
            if evicted > 0 {
                tracing::warn!(
                    "Evicted {} stale request-cache entr{} (TTL={}s, remaining={})",
                    evicted,
                    if evicted == 1 { "y" } else { "ies" },
                    REQUEST_CACHE_TTL_SECS,
                    len,
                );
            } else if len > 0 {
                tracing::debug!(
                    "Request cache sweep: {} active entries (TTL={}s)",
                    len,
                    REQUEST_CACHE_TTL_SECS,
                );
            }

            // Also sweep abort-handle registries for tokens whose owning
            // stream has already finished/aborted (Rust #6).
            sweep_stale_abort_handles();
        }
    });
}

// ====================== TEST UTILITIES ======================

/// Global mutex to serialize all test access to [`REQUEST_CACHE`].
/// Prevents deadlocks when multiple tests run in parallel and contend
/// for the same DashMap shards.
use tokio::sync::Mutex;

static TEST_CACHE_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Acquires the global test cache lock. All tests that access
/// [`REQUEST_CACHE`] must call this function at the beginning to
/// prevent inter-test contention and deadlocks.
///
/// If the mutex is poisoned (a previous test panicked while holding it),
/// we recover by poisoning our own lock guard - this allows subsequent
/// tests to still acquire the lock and clear the cache.
pub async fn test_cache_lock() -> tokio::sync::MutexGuard<'static, ()> {
    TEST_CACHE_MUTEX.lock().await
}

/// Clears all entries from [`REQUEST_CACHE`].
/// Use in tests to ensure a clean slate before/after operations.
/// This is preferred over mutex-based serialization because DashMap
/// handles concurrent access safely - we only need test isolation.
pub fn clear_request_cache() {
    REQUEST_CACHE.clear();
}
