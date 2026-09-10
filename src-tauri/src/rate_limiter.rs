//! Rate limiting utilities for IPC commands.
//!
//! This module provides per-command and per-window rate limiting to prevent
//! a compromised frontend from spamming backend commands.

use dashmap::DashMap;
use std::time::{Duration, Instant};

use crate::error_codes;
use crate::payloads::BackendError;

/// Rate limit configuration for a specific command.
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    /// Maximum number of requests allowed in the time window.
    pub max_requests: usize,
    /// Duration of the time window in milliseconds.
    pub window_ms: u64,
}

/// Commands that are intentionally **unlimited** because they are cheap,
/// non-amplifying, and safe to invoke at any rate (e.g. pure in-memory reads,
/// no-op status queries, or operations already bounded by a global semaphore).
///
/// Every command NOT in this list and NOT in [`RateLimiter::new`]'s config is
/// a *missing policy* — see [`RateLimiter::check_rate_limit`], which logs a
/// warning for that case so a future sensitive command cannot silently become
/// unlimited. This list is the explicit counterpart to the implicit `None`
/// default that previously made every unconfigured command unlimited.
const UNLIMITED_COMMANDS: &[&str] = &[
    // Pure metadata / no-op / in-memory reads
    "cmd_get_app_version",
    "cmd_metrics_snapshot",
    "cmd_tray_get_background_status",
    "cmd_menu_rebuild",
    "cmd_context_menu_show",
    // Abort operations (idempotent, cheap)
    "cmd_ollama_abort_chat",
    "cmd_ollama_abort_pull",
    "cmd_rag_abort_index",
    // Dialog / opener (user-gated, not renderer-amplifiable)
    "cmd_dialog_ask",
    "cmd_dialog_open_file",
    "cmd_dialog_save_file",
    "cmd_opener_open_url",
    // Store read/write (already size-capped per value; single-user KV)
    "cmd_store_load",
    "cmd_store_get",
    "cmd_store_set",
    "cmd_store_save",
    "cmd_store_delete",
    // RAG project metadata (cheap DB reads/writes, no network)
    "cmd_rag_list_projects",
    "cmd_rag_list_files",
    "cmd_rag_update_project",
    "cmd_rag_set_embedding_model",
    // Conversation metadata (cheap DB reads/writes)
    "cmd_conversations_list",
    "cmd_conversation_get",
    "cmd_conversation_create",
    "cmd_conversation_update",
    "cmd_conversation_search",
    "cmd_message_append",
    // Migration status (read-only)
    "cmd_get_migration_status",
    "cmd_list_migrations",
    // Log/trace management (already rate-limited on the append path)
    "cmd_logs_request_clear_token",
    "cmd_logs_clear",
    "cmd_trace_start",
    "cmd_trace_complete",
    "cmd_trace_get_context",
];

/// Upper bound on the number of distinct `(window_label, command)` keys the
/// limiter will track. Window labels are fixed at app build time (a single
/// `main` window), so this is far above any legitimate count, but it prevents
/// unbounded growth if a future code path ever derives the key from
/// attacker-controlled input.
const MAX_TRACKED_KEYS: usize = 1024;

/// Rate limiter that tracks request timestamps per key.
#[derive(Debug)]
pub struct RateLimiter {
    /// Map of command names to their rate limit configurations.
    command_configs: DashMap<String, RateLimitConfig>,
    /// Map of (window_label, command) -> Vec<Instant> for tracking request timestamps.
    request_timestamps: DashMap<(String, String), Vec<Instant>>,
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl RateLimiter {
    /// Creates a new rate limiter with default configurations.
    pub fn new() -> Self {
        let limiter = Self {
            command_configs: DashMap::new(),
            request_timestamps: DashMap::new(),
        };

        // Set default rate limits for sensitive commands
        limiter.set_command_config(
            "cmd_ollama_chat",
            RateLimitConfig {
                max_requests: 10,
                window_ms: 1000, // 10 requests per second
            },
        );

        limiter.set_command_config(
            "cmd_ollama_pull_model",
            RateLimitConfig {
                max_requests: 3,
                window_ms: 60000, // 3 requests per minute
            },
        );

        limiter.set_command_config(
            "cmd_ollama_generate_title",
            RateLimitConfig {
                max_requests: 5,
                window_ms: 1000, // 5 requests per second
            },
        );

        limiter.set_command_config(
            "cmd_rag_index_project",
            RateLimitConfig {
                max_requests: 2,
                window_ms: 60000, // 2 requests per minute
            },
        );

        limiter.set_command_config(
            "cmd_ollama_delete_model",
            RateLimitConfig {
                max_requests: 3,
                window_ms: 60000, // 3 requests per minute — destructive
            },
        );

        limiter.set_command_config(
            "cmd_rollback_migrations",
            RateLimitConfig {
                max_requests: 2,
                window_ms: 60000, // 2 requests per minute — destructive
            },
        );

        limiter.set_command_config(
            "cmd_conversations_clear",
            RateLimitConfig {
                max_requests: 3,
                window_ms: 60000, // 3 requests per minute — destructive
            },
        );

        limiter.set_command_config(
            "cmd_conversation_delete",
            RateLimitConfig {
                max_requests: 10,
                window_ms: 60000, // 10 requests per minute — destructive
            },
        );

        limiter.set_command_config(
            "cmd_message_delete",
            RateLimitConfig {
                max_requests: 10,
                window_ms: 60000, // 10 requests per minute — destructive
            },
        );

        limiter.set_command_config(
            "cmd_rag_remove_project",
            RateLimitConfig {
                max_requests: 5,
                window_ms: 60000, // 5 requests per minute — index teardown
            },
        );

        limiter.set_command_config(
            "cmd_fs_write_text_file",
            RateLimitConfig {
                max_requests: 30,
                window_ms: 1000, // 30 writes per second — disk hammering guard
            },
        );

        limiter.set_command_config(
            "cmd_logs_append",
            RateLimitConfig {
                max_requests: 20,
                window_ms: 1000, // 20 log entries per second — log-flood guard
            },
        );

        limiter.set_command_config(
            "cmd_trace_append",
            RateLimitConfig {
                max_requests: 20,
                window_ms: 1000, // 20 trace entries per second — log-flood guard
            },
        );

        // ── Read / search / network-probe commands ──────────────────────
        // These were previously unlimited (fail-open). Each triggers either a
        // disk read, an Ollama round-trip, or a DB scan, so a compromised
        // renderer could invoke them without bound. Limits are generous
        // enough for normal interactive use but bound the amplification.

        limiter.set_command_config(
            "cmd_rag_search",
            RateLimitConfig {
                max_requests: 10,
                window_ms: 1000, // 10 searches per second — each is an Ollama embed round-trip
            },
        );

        limiter.set_command_config(
            "cmd_rag_assemble_context",
            RateLimitConfig {
                max_requests: 10,
                window_ms: 1000, // 10 assemblies per second — search + context build
            },
        );

        limiter.set_command_config(
            "cmd_rag_get_file_chunks",
            RateLimitConfig {
                max_requests: 30,
                window_ms: 1000, // 30 chunk reads per second — DB scan, up to 100 chunks each
            },
        );

        limiter.set_command_config(
            "cmd_fs_read_file",
            RateLimitConfig {
                max_requests: 30,
                window_ms: 1000, // 30 binary reads per second — disk read + base64 encode
            },
        );

        limiter.set_command_config(
            "cmd_fs_read_text_file",
            RateLimitConfig {
                max_requests: 30,
                window_ms: 1000, // 30 text reads per second — disk read
            },
        );

        limiter.set_command_config(
            "cmd_ollama_get_models",
            RateLimitConfig {
                max_requests: 10,
                window_ms: 1000, // 10 model listings per second — Ollama /api/tags round-trip
            },
        );

        limiter.set_command_config(
            "cmd_ollama_validate_model",
            RateLimitConfig {
                max_requests: 10,
                window_ms: 1000, // 10 validations per second — Ollama /api/show round-trip
            },
        );

        limiter.set_command_config(
            "cmd_ollama_verify_service",
            RateLimitConfig {
                max_requests: 10,
                window_ms: 1000, // 10 verifications per second — Ollama root round-trip
            },
        );

        limiter.set_command_config(
            "cmd_ollama_check_health",
            RateLimitConfig {
                max_requests: 10,
                window_ms: 1000, // 10 health checks per second — Ollama /api/tags round-trip
            },
        );

        limiter
    }

    /// Sets a rate limit configuration for a specific command.
    pub fn set_command_config(&self, command: &str, config: RateLimitConfig) {
        self.command_configs.insert(command.to_string(), config);
    }

    /// Checks if a command from a specific window is rate limited.
    /// Returns `Ok(())` if the request is allowed, or `Err(BackendError)` if rate limited.
    pub fn check_rate_limit(&self, window_label: &str, command: &str) -> Result<(), BackendError> {
        // Get the rate limit config for this command
        let config = match self.command_configs.get(command) {
            Some(config) => config.clone(),
            None => {
                // No explicit config. Distinguish "intentionally unlimited"
                // (explicit allowlist) from "missing policy" (a future
                // sensitive command that was never configured). The latter is
                // logged so it cannot silently become unlimited; it is still
                // allowed at runtime to avoid breaking unknown commands, but
                // the warning surfaces the gap for review.
                if !UNLIMITED_COMMANDS.contains(&command) {
                    tracing::warn!(
                        command = %command,
                        "Command has no rate-limit policy and is not in the explicit \
                         unlimited allowlist — treat as a missing policy"
                    );
                }
                return Ok(());
            }
        };

        // Use window label as the rate limiting key
        let key = (window_label.to_string(), command.to_string());

        // Bound the number of tracked keys so attacker-controlled identifiers
        // (if ever introduced) cannot grow this map without limit. Window
        // labels are fixed today, so this is defense-in-depth.
        if self.request_timestamps.len() >= MAX_TRACKED_KEYS
            && !self.request_timestamps.contains_key(&key)
        {
            tracing::warn!(
                "Rate limiter key table at capacity ({}); refusing to track new key",
                MAX_TRACKED_KEYS
            );
            return Err(BackendError::new(
                error_codes::RATE_LIMITED,
                "Rate limiter key table is full",
            ));
        }

        // Get current timestamps for this window+command
        let mut timestamps = self.request_timestamps.entry(key.clone()).or_default();

        // Remove timestamps that are outside the current window
        let now = Instant::now();
        let window_start = now - Duration::from_millis(config.window_ms);
        timestamps.retain(|&timestamp| timestamp >= window_start);

        // Check if the number of requests exceeds the limit
        if timestamps.len() >= config.max_requests {
            return Err(BackendError::new(
                error_codes::RATE_LIMITED,
                format!(
                    "Rate limit exceeded for command '{}'. Maximum {} requests per {}ms.",
                    command, config.max_requests, config.window_ms
                ),
            ));
        }

        // Add the current request timestamp
        timestamps.push(now);

        Ok(())
    }
}

/// Global rate limiter instance.
pub static RATE_LIMITER: std::sync::LazyLock<RateLimiter> =
    std::sync::LazyLock::new(RateLimiter::new);

/// Checks the global limiter for a command invoked from a window.
/// Returns `Err(BackendError)` with [`crate::error_codes::RATE_LIMITED`]
/// when the window's quota for the command is exhausted.
pub fn check(window_label: &str, command: &str) -> Result<(), BackendError> {
    RATE_LIMITER.check_rate_limit(window_label, command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limiter_allows_requests_within_limit() {
        let limiter = RateLimiter::new();

        // Should allow requests within the limit
        for _ in 0..10 {
            assert!(limiter
                .check_rate_limit("test_window", "cmd_ollama_chat")
                .is_ok());
        }
    }

    #[test]
    fn test_rate_limiter_blocks_requests_exceeding_limit() {
        let limiter = RateLimiter::new();

        // Exhaust the limit
        for _ in 0..10 {
            assert!(limiter
                .check_rate_limit("test_window", "cmd_ollama_chat")
                .is_ok());
        }

        // Next request should be rate limited
        assert!(limiter
            .check_rate_limit("test_window", "cmd_ollama_chat")
            .is_err());
    }

    #[test]
    fn test_rate_limiter_resets_after_window() {
        let limiter = RateLimiter::new();

        // Exhaust the limit
        for _ in 0..10 {
            assert!(limiter
                .check_rate_limit("test_window", "cmd_ollama_chat")
                .is_ok());
        }

        // Wait for the window to pass
        std::thread::sleep(std::time::Duration::from_millis(1001));

        // Should allow requests again
        assert!(limiter
            .check_rate_limit("test_window", "cmd_ollama_chat")
            .is_ok());
    }

    #[test]
    fn test_rate_limiter_different_windows_have_different_limits() {
        let limiter = RateLimiter::new();

        // Exhaust limit for window1
        for _ in 0..10 {
            assert!(limiter
                .check_rate_limit("window1", "cmd_ollama_chat")
                .is_ok());
        }

        // window2 should still be allowed
        assert!(limiter
            .check_rate_limit("window2", "cmd_ollama_chat")
            .is_ok());
    }

    #[test]
    fn test_rate_limiter_different_commands_have_different_limits() {
        let limiter = RateLimiter::new();

        // Exhaust limit for cmd_ollama_chat
        for _ in 0..10 {
            assert!(limiter
                .check_rate_limit("test_window", "cmd_ollama_chat")
                .is_ok());
        }

        // cmd_ollama_pull_model should still be allowed (different limit)
        assert!(limiter
            .check_rate_limit("test_window", "cmd_ollama_pull_model")
            .is_ok());
    }

    #[test]
    fn test_rate_limiter_no_config_allows_unlimited() {
        let limiter = RateLimiter::new();

        // Should allow unlimited requests for commands without rate limits
        for _ in 0..100 {
            assert!(limiter
                .check_rate_limit("test_window", "unknown_command")
                .is_ok());
        }
    }

    #[test]
    fn test_rate_limiter_burst_at_window_boundary() {
        let limiter = RateLimiter::new();

        // Exhaust limit for cmd_ollama_chat (10 per second)
        for _ in 0..10 {
            assert!(limiter
                .check_rate_limit("burst_window", "cmd_ollama_chat")
                .is_ok());
        }

        // 11th request should fail
        assert!(limiter
            .check_rate_limit("burst_window", "cmd_ollama_chat")
            .is_err());

        // Wait for window to reset
        std::thread::sleep(std::time::Duration::from_millis(1001));

        // Should allow full burst again
        for _ in 0..10 {
            assert!(limiter
                .check_rate_limit("burst_window", "cmd_ollama_chat")
                .is_ok());
        }
    }

    #[test]
    fn test_rate_limiter_exact_limit_boundary() {
        let limiter = RateLimiter::new();

        // Exactly at limit (10 requests for cmd_ollama_chat)
        for i in 0..10 {
            let result = limiter.check_rate_limit("boundary", "cmd_ollama_chat");
            assert!(result.is_ok(), "Request {} should succeed", i + 1);
        }

        // One over limit should fail
        let result = limiter.check_rate_limit("boundary", "cmd_ollama_chat");
        assert!(result.is_err(), "Request 11 should fail");
    }

    #[test]
    fn test_rate_limiter_refill_timing_precision() {
        let limiter = RateLimiter::new();

        // Use all tokens
        for _ in 0..10 {
            let _ = limiter.check_rate_limit("timing", "cmd_ollama_chat");
        }

        // Verify blocked before window expires
        assert!(limiter
            .check_rate_limit("timing", "cmd_ollama_chat")
            .is_err());

        // Sleep slightly less than window
        std::thread::sleep(std::time::Duration::from_millis(900));

        // Should still be blocked (window hasn't fully reset)
        assert!(limiter
            .check_rate_limit("timing", "cmd_ollama_chat")
            .is_err());

        // Sleep remaining time
        std::thread::sleep(std::time::Duration::from_millis(200));

        // Should allow requests again
        assert!(limiter
            .check_rate_limit("timing", "cmd_ollama_chat")
            .is_ok());
    }

    #[test]
    fn test_rate_limiter_sliding_window_behavior() {
        let limiter = RateLimiter::new();

        // Make 5 requests
        for _ in 0..5 {
            let _ = limiter.check_rate_limit("sliding", "cmd_ollama_chat");
        }

        // Wait half a window
        std::thread::sleep(std::time::Duration::from_millis(500));

        // Make 5 more requests
        for _ in 0..5 {
            let _ = limiter.check_rate_limit("sliding", "cmd_ollama_chat");
        }

        // Should now be at limit (10 total in current window)
        assert!(limiter
            .check_rate_limit("sliding", "cmd_ollama_chat")
            .is_err());

        // Wait until first 5 requests expire from window
        std::thread::sleep(std::time::Duration::from_millis(600));

        // Should allow ~5 new requests (first 5 expired)
        // At least 1 should work
        assert!(limiter
            .check_rate_limit("sliding", "cmd_ollama_chat")
            .is_ok());
    }

    #[test]
    fn test_rate_limiter_underflow_protection() {
        let limiter = RateLimiter::new();

        // Set an extreme config to test edge cases
        limiter.set_command_config(
            "test_extreme",
            RateLimitConfig {
                max_requests: 1,
                window_ms: 100,
            },
        );

        // Make 1 request
        assert!(limiter.check_rate_limit("extreme", "test_extreme").is_ok());

        // Should be blocked
        assert!(limiter.check_rate_limit("extreme", "test_extreme").is_err());

        // Wait for reset
        std::thread::sleep(std::time::Duration::from_millis(150));

        // Should allow again
        assert!(limiter.check_rate_limit("extreme", "test_extreme").is_ok());
    }

    #[test]
    fn test_rate_limiter_preserves_timestamp_order() {
        let limiter = RateLimiter::new();

        // Make requests in quick succession
        for _ in 0..5 {
            let _ = limiter.check_rate_limit("order", "cmd_ollama_chat");
        }

        // Verify timestamps are retained in order
        let key = ("order".to_string(), "cmd_ollama_chat".to_string());
        let timestamps = limiter.request_timestamps.get(&key);
        assert!(timestamps.is_some());
        let timestamps = timestamps.unwrap();
        assert_eq!(timestamps.len(), 5);
    }

    // ── F5: explicit policy coverage ──────────────────────────────────

    #[test]
    fn test_expensive_commands_have_explicit_policy() {
        // Every network/disk/DB-amplifying command must have an explicit
        // rate-limit config (not fall through to the unlimited default).
        let limiter = RateLimiter::new();
        let expensive = [
            "cmd_rag_search",
            "cmd_rag_assemble_context",
            "cmd_rag_get_file_chunks",
            "cmd_fs_read_file",
            "cmd_fs_read_text_file",
            "cmd_ollama_get_models",
            "cmd_ollama_validate_model",
            "cmd_ollama_verify_service",
            "cmd_ollama_check_health",
        ];
        for cmd in expensive {
            assert!(
                limiter.command_configs.contains_key(cmd),
                "expensive command {cmd} must have an explicit rate-limit policy"
            );
        }
    }

    #[test]
    fn test_intentionally_unlimited_commands_are_allowlisted() {
        // Cheap commands are explicitly allowlisted, not silently unlimited.
        let limiter = RateLimiter::new();
        for cmd in UNLIMITED_COMMANDS {
            assert!(
                !limiter.command_configs.contains_key(*cmd),
                "allowlisted command {cmd} must not also have a rate-limit config"
            );
            // And they must be allowed without consuming a tracked key.
            assert!(limiter.check_rate_limit("w", cmd).is_ok());
        }
    }

    #[test]
    fn test_missing_policy_command_is_allowed_but_not_allowlisted() {
        // A command with neither a config nor an allowlist entry is a
        // "missing policy" — it is still allowed at runtime (to avoid breaking
        // unknown commands) but must NOT be in the explicit allowlist, so the
        // warning path is exercised and the gap is visible.
        let limiter = RateLimiter::new();
        let unknown = "cmd_some_future_command";
        assert!(!limiter.command_configs.contains_key(unknown));
        assert!(!UNLIMITED_COMMANDS.contains(&unknown));
        assert!(limiter.check_rate_limit("w", unknown).is_ok());
    }

    #[test]
    fn test_rag_search_is_rate_limited() {
        let limiter = RateLimiter::new();
        for _ in 0..10 {
            assert!(limiter.check_rate_limit("w", "cmd_rag_search").is_ok());
        }
        assert!(limiter.check_rate_limit("w", "cmd_rag_search").is_err());
    }

    #[test]
    fn test_fs_read_file_is_rate_limited() {
        let limiter = RateLimiter::new();
        for _ in 0..30 {
            assert!(limiter.check_rate_limit("w", "cmd_fs_read_file").is_ok());
        }
        assert!(limiter.check_rate_limit("w", "cmd_fs_read_file").is_err());
    }

    #[test]
    fn test_key_table_is_bounded() {
        let limiter = RateLimiter::new();
        // Drive many distinct (window, command) keys through a configured
        // command to prove the key table does not grow without bound.
        limiter.set_command_config(
            "bounded_cmd",
            RateLimitConfig {
                max_requests: 1,
                window_ms: 60_000,
            },
        );
        for i in 0..(MAX_TRACKED_KEYS + 100) {
            let label = format!("window-{i}");
            // Each distinct label is a new key; once at capacity, new keys are
            // rejected rather than growing the map.
            let _ = limiter.check_rate_limit(&label, "bounded_cmd");
        }
        assert!(
            limiter.request_timestamps.len() <= MAX_TRACKED_KEYS,
            "key table grew to {} (cap {})",
            limiter.request_timestamps.len(),
            MAX_TRACKED_KEYS
        );
    }
}
