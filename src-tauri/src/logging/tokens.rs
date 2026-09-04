//! Log clear token management — single-use, TTL-bounded confirmation tokens
//! for destructive log-clear operations.
//!
//! Frontends must request a token via [`request_token`] and present it via
//! [`validate_token`] within the TTL window. Expired tokens are evicted lazily
//! on every request/validate call.
//!
//! Pulled out of `commands.rs` so that `commands.rs` remains a thin adapter
//! layer per STANDARDS.md §6. The token map is a process-wide singleton so the
//! issue and consume paths share one store regardless of which command handler
//! they enter through.
//!
//! Test isolation: all state and time live inside [`TokenStore`]; the
//! singleton is just one instance. Tests construct their own store with an
//! injected clock, so no process-global state or wall clock is shared and
//! parallel `cargo test` cannot race.

use dashmap::DashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

/// Time-to-live for a log-clear confirmation token (seconds).
pub(crate) const LOG_CLEAR_TOKEN_TTL_SECS: u64 = 30;

/// A self-contained token store. All TTL logic depends only on the injected
/// `now` closure — never on the wall clock directly — so tests can drive
/// time deterministically.
pub(crate) struct TokenStore {
    map: DashMap<String, Instant>,
    now: Box<dyn Fn() -> Instant + Send + Sync>,
}

impl TokenStore {
    /// Production constructor: wall-clock time source.
    fn new() -> Self {
        Self {
            map: DashMap::new(),
            now: Box::new(Instant::now),
        }
    }

    /// Test constructor: deterministic injected clock.
    #[cfg(test)]
    fn with_clock(now: Box<dyn Fn() -> Instant + Send + Sync>) -> Self {
        Self {
            map: DashMap::new(),
            now,
        }
    }

    /// Issues a fresh token stamped with the injected `now`.
    fn issue(&self) -> String {
        self.evict_expired();
        let token = uuid::Uuid::new_v4().to_string();
        self.map.insert(token.clone(), (self.now)());
        token
    }

    /// Removes expired entries from the token store.
    fn evict_expired(&self) {
        let cutoff = (self.now)().checked_sub(Duration::from_secs(LOG_CLEAR_TOKEN_TTL_SECS));
        match cutoff {
            Some(c) => self.map.retain(|_, created| *created > c),
            // System uptime < TTL: every token predates the cutoff, so evict all.
            None => self.map.clear(),
        }
    }
}

/// Process-wide token store used by the command handlers.
static TOKEN_STORE: LazyLock<TokenStore> = LazyLock::new(TokenStore::new);

/// Issues a new single-use confirmation token and returns it to the caller.
///
/// Evicts expired tokens first so the pending count stays bounded. The caller
/// must present the returned string back to [`validate_token`] within
/// [`LOG_CLEAR_TOKEN_TTL_SECS`] seconds.
pub(crate) fn request_token() -> String {
    let token = TOKEN_STORE.issue();

    tracing::info!(
        "Log clear token issued (TTL={}s, pending={})",
        LOG_CLEAR_TOKEN_TTL_SECS,
        TOKEN_STORE.map.len()
    );

    token
}

/// Outcome of validating a clear token — distinguishes the three failure
/// branches so the command adapter can return the correct IPC error code
/// without re-implementing the timing checks.
#[derive(Debug)]
pub(crate) enum TokenValidation {
    /// Token matched and is within the TTL window. Carries the elapsed time
    /// for observability logging.
    Valid { elapsed: Duration },
    /// Token matched but is past the TTL window. The elapsed time is already
    /// logged by `validate_token`, so the adapter doesn't need it.
    Expired,
    /// Token did not match any pending entry (already used, never issued, or
    /// evicted by a prior call).
    NotFound,
}

fn validate_in(store: &TokenStore, token: &str) -> TokenValidation {
    // Atomically remove and validate the token FIRST (single-use). Eviction
    // runs AFTER the lookup: if it ran first, a TTL-expired token would be
    // swept and reported as NotFound, making the Expired branch unreachable.
    let entry = store.map.remove(token);
    store.evict_expired();
    match entry {
        Some((_, created)) => {
            let elapsed = (store.now)().duration_since(created);
            if elapsed > Duration::from_secs(LOG_CLEAR_TOKEN_TTL_SECS) {
                tracing::warn!(
                    "Expired log clear token rejected (elapsed={:.1}s, TTL={}s)",
                    elapsed.as_secs_f64(),
                    LOG_CLEAR_TOKEN_TTL_SECS
                );
                TokenValidation::Expired
            } else {
                TokenValidation::Valid { elapsed }
            }
        }
        None => {
            tracing::warn!("Invalid log clear token rejected");
            TokenValidation::NotFound
        }
    }
}

/// Validates and consumes a single-use log-clear token.
///
/// Regardless of outcome, a matched token is removed from the pending store
/// (it can only be used once). Unmatched tokens are left untouched — there is
/// nothing to consume and an attacker learns nothing about which strings are
/// currently pending.
pub(crate) fn validate_token(token: &str) -> TokenValidation {
    validate_in(&TOKEN_STORE, token)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// Deterministic clock: every `advance(delta)` moves the virtual time
    /// forward; `now` closures see exactly `base + elapsed`. Each test gets a
    /// fresh store — nothing process-global or wall-clock-dependent.
    struct TestClock {
        base: Instant,
        offset: StdMutex<Duration>,
    }

    impl TestClock {
        fn store() -> (TokenStore, std::sync::Arc<TestClock>) {
            let clock = std::sync::Arc::new(TestClock {
                base: Instant::now(),
                offset: StdMutex::new(Duration::ZERO),
            });
            let c = clock.clone();
            let store =
                TokenStore::with_clock(Box::new(move || c.base + *c.offset.lock().unwrap()));
            (store, clock)
        }

        fn advance(&self, d: Duration) {
            *self.offset.lock().unwrap() += d;
        }
    }

    #[test]
    fn issued_token_validates_within_window() {
        let (store, _clock) = TestClock::store();
        let token = store.issue();
        assert!(matches!(
            validate_in(&store, &token),
            TokenValidation::Valid { .. }
        ));
    }

    #[test]
    fn token_is_single_use() {
        let (store, _clock) = TestClock::store();
        let token = store.issue();
        assert!(matches!(
            validate_in(&store, &token),
            TokenValidation::Valid { .. }
        ));
        // Second use must fail — token was consumed.
        assert!(matches!(
            validate_in(&store, &token),
            TokenValidation::NotFound
        ));
    }

    #[test]
    fn unknown_token_is_not_found() {
        let (store, _clock) = TestClock::store();
        assert!(matches!(
            validate_in(&store, "never-issued"),
            TokenValidation::NotFound
        ));
    }

    #[test]
    fn token_expires_past_ttl_with_injected_clock() {
        let (store, clock) = TestClock::store();
        let token = store.issue();
        clock.advance(Duration::from_secs(LOG_CLEAR_TOKEN_TTL_SECS + 1));
        assert!(matches!(
            validate_in(&store, &token),
            TokenValidation::Expired
        ));
    }

    #[test]
    fn evict_removes_expired_entries() {
        let (store, clock) = TestClock::store();
        let stale = store.issue();
        clock.advance(Duration::from_secs(LOG_CLEAR_TOKEN_TTL_SECS + 5));
        let fresh = store.issue();
        store.evict_expired();
        assert!(!store.map.contains_key(&stale));
        assert!(store.map.contains_key(&fresh));
    }
}
