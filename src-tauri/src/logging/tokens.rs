//! Log clear token management — single-use, TTL-bounded confirmation tokens
//! for destructive log-clear operations.
//!
//! Frontends must request a token via [`request_token`] and present it via
//! [`validate_token`] within the TTL window. Expired tokens are evicted lazily
//! on every request/validate call and explicitly during tests via a guard.
//!
//! Pulled out of `commands.rs` so that `commands.rs` remains a thin adapter
//! layer per STANDARDS.md §6. The token map is a process-wide singleton so the
//! issue and consume paths share one store regardless of which command handler
//! they enter through.

use dashmap::DashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

/// Time-to-live for a log-clear confirmation token (seconds).
pub(crate) const LOG_CLEAR_TOKEN_TTL_SECS: u64 = 30;

/// Pending confirmation tokens for destructive log-clear operations.
/// Maps token string → creation instant. Tokens are single-use and TTL-bounded.
static LOG_CLEAR_TOKENS: LazyLock<DashMap<String, Instant>> = LazyLock::new(DashMap::new);

/// Removes expired entries from the log-clear token store.
///
/// Skips eviction during tests to avoid race conditions with parallel test
/// execution — the `TESTING` environment variable is set by the test harness.
fn evict_expired_clear_tokens() {
    // Skip eviction during tests to avoid race conditions with parallel test execution
    if std::env::var("TESTING").is_ok() {
        return;
    }

    let cutoff = Instant::now().checked_sub(Duration::from_secs(LOG_CLEAR_TOKEN_TTL_SECS));

    match cutoff {
        Some(c) => LOG_CLEAR_TOKENS.retain(|_, created| *created > c),
        // System uptime < TTL: every token predates the cutoff, so evict all.
        None => LOG_CLEAR_TOKENS.clear(),
    }
}

/// Issues a new single-use confirmation token and returns it to the caller.
///
/// Evicts expired tokens first so the pending count stays bounded. The caller
/// must present the returned string back to [`validate_token`] within
/// [`LOG_CLEAR_TOKEN_TTL_SECS`] seconds.
pub(crate) fn request_token() -> String {
    evict_expired_clear_tokens();

    let token = uuid::Uuid::new_v4().to_string();
    LOG_CLEAR_TOKENS.insert(token.clone(), Instant::now());

    tracing::info!(
        "Log clear token issued (TTL={}s, pending={})",
        LOG_CLEAR_TOKEN_TTL_SECS,
        LOG_CLEAR_TOKENS.len()
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

/// Validates and consumes a single-use log-clear token.
///
/// Regardless of outcome, a matched token is removed from the pending store
/// (it can only be used once). Unmatched tokens are left untouched — there is
/// nothing to consume and an attacker learns nothing about which strings are
/// currently pending.
pub(crate) fn validate_token(token: &str) -> TokenValidation {
    evict_expired_clear_tokens();

    // Atomically remove and validate the token (single-use)
    let entry = LOG_CLEAR_TOKENS.remove(token);
    match entry {
        Some((_, created)) => {
            let elapsed = created.elapsed();
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Bypass the TESTING-env eviction guard so tests can exercise the
    /// time-based eviction path explicitly.
    fn force_evict() {
        let cutoff = Instant::now().checked_sub(Duration::from_secs(LOG_CLEAR_TOKEN_TTL_SECS));
        match cutoff {
            Some(c) => LOG_CLEAR_TOKENS.retain(|_, created| *created > c),
            None => LOG_CLEAR_TOKENS.clear(),
        }
    }

    #[test]
    fn issued_token_validates_within_window() {
        // The TESTING env guard short-circuits eviction inside validate_token,
        // but a freshly issued token should still validate regardless.
        let token = request_token();
        match validate_token(&token) {
            TokenValidation::Valid { .. } => {}
            other => panic!("expected Valid, got {:?}", other),
        }
    }

    #[test]
    fn token_is_single_use() {
        let token = request_token();
        assert!(matches!(
            validate_token(&token),
            TokenValidation::Valid { .. }
        ));
        // Second use must fail — token was consumed.
        assert!(matches!(validate_token(&token), TokenValidation::NotFound));
    }

    #[test]
    fn unknown_token_is_not_found() {
        assert!(matches!(
            validate_token("never-issued"),
            TokenValidation::NotFound
        ));
    }

    #[test]
    fn force_evict_removes_expired_entries() {
        // Assert per-key, never is_empty(): sibling tests issue live tokens
        // into the shared process-global map on parallel threads.
        LOG_CLEAR_TOKENS.insert(
            "stale".to_string(),
            Instant::now() - Duration::from_secs(LOG_CLEAR_TOKEN_TTL_SECS + 5),
        );
        LOG_CLEAR_TOKENS.insert("fresh".to_string(), Instant::now());
        force_evict();
        assert!(!LOG_CLEAR_TOKENS.contains_key("stale"));
        assert!(LOG_CLEAR_TOKENS.contains_key("fresh"));
    }
}
