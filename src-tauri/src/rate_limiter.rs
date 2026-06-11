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
            None => return Ok(()), // No rate limit configured for this command
        };

        // Use window label as the rate limiting key
        let key = (window_label.to_string(), command.to_string());

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
}
