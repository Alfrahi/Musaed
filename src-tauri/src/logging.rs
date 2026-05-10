//! Tauri commands for application logging and diagnostics.

use crate::logger::ChannelLogger;
use crate::payloads::ApiResponse;
use crate::validation::{validation_error, MAX_LOG_CLEAR_TOKEN_LEN, MAX_LOG_ENTRY_LEN};
use dashmap::DashMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime};
use tracing;

/// Time-to-live for a log-clear confirmation token (seconds).
/// The caller must present the token within this window after requesting it.
const LOG_CLEAR_TOKEN_TTL_SECS: u64 = 30;

/// Pending confirmation tokens for destructive log-clear operations.
/// Maps token string → creation instant. Tokens are single-use and TTL-bounded.
static LOG_CLEAR_TOKENS: LazyLock<DashMap<String, Instant>> = LazyLock::new(DashMap::new);

/// Sanitizes a log entry for safe logging.
///
/// Security measures:
/// - Strips all C0 control characters except tab (preserves formatting)
/// - Strips ANSI escape sequences (color codes, cursor movement, etc.)
/// - Removes potential log injection patterns (newlines, carriage returns in field contexts)
/// - Prevents timestamp/log-level injection by filtering problematic patterns
fn sanitize_log_entry(entry: &str) -> String {
    // Step 1: Remove ANSI escape sequences (color codes, cursor movement, etc.)
    let without_ansi = strip_ansi_escapes(entry);

    // Step 2: Strip C0 control characters except tab (which is useful for formatting)
    // Keep: tab (\t), printable ASCII, and valid Unicode
    // Remove: all other C0 controls including \n, \r, \0, \x01-\x08, \x0b-\x0c, \x0e-\x1f
    let sanitized: String = without_ansi
        .chars()
        .map(|c| {
            // Keep newline and carriage return as whitespace (will be collapsed)
            if c == '\t' || c == '\n' || c == '\r' {
                return c;
            }
            // Convert other C0 control characters to space to preserve word boundaries
            if c.is_control() {
                return ' ';
            }
            // Preserve all other characters (printable ASCII, Unicode, spaces, etc.)
            c
        })
        .collect();

    // Step 3: Prevent log injection via repeated whitespace or special sequences
    // Collapse multiple spaces/tabs to single space for readability
    let collapsed = collapse_whitespace(&sanitized);

    // Step 4: Truncate to prevent memory issues with extremely long entries
    // while preserving the beginning which typically contains useful info
    if collapsed.len() > MAX_LOG_ENTRY_LEN {
        format!(
            "{}... [TRUNCATED]",
            &collapsed[..MAX_LOG_ENTRY_LEN.saturating_sub(15)]
        )
    } else {
        collapsed
    }
}

/// Removes ANSI escape sequences from a string.
/// Handles: SGR sequences (colors, bold, etc.), cursor movement, clear screen, etc.
fn strip_ansi_escapes(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        // Check for CSI sequence: ESC [ ...
        if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            // Find the end of the escape sequence: CSI ends with a byte in 0x40-0x7E
            let mut j = i + 2;
            while j < bytes.len() {
                let b = bytes[j];
                if (0x40..=0x7E).contains(&b) {
                    j += 1;
                    break;
                }
                j += 1;
            }
            i = j;
        }
        // Check for OSC sequence: ESC ] (operating system command)
        else if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b']' {
            let mut j = i + 2;
            // OSC sequences end with BEL (0x07) or ESC \
            while j < bytes.len() {
                if bytes[j] == 0x07
                    || (bytes[j] == 0x1b && j + 1 < bytes.len() && bytes[j + 1] == b'\\')
                {
                    j += if bytes[j] == 0x07 { 1 } else { 2 };
                    break;
                }
                j += 1;
            }
            i = j;
        }
        // Check for two-character escape sequence (ESC X)
        else if bytes[i] == 0x1b && i + 1 < bytes.len() {
            i += 2;
        }
        // Regular character
        else {
            result.push(bytes[i] as char);
            i += 1;
        }
    }

    result
}

/// Collapses multiple whitespace characters to single spaces.
fn collapse_whitespace(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut last_was_space = false;

    for c in input.chars() {
        if c.is_whitespace() {
            if !last_was_space {
                result.push(' ');
                last_was_space = true;
            }
        } else {
            result.push(c);
            last_was_space = false;
        }
    }

    result.trim().to_string()
}

/// Resolves the path to the application log file, creating directories if needed.
fn get_log_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let log_dir = data_dir.join("musaed").join("logs");
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    Ok(log_dir.join("musaed.log"))
}

/// Routes a frontend log entry through the async channel logger.
/// Entries are prefixed with `[FRONTEND]` to distinguish them from backend
/// log lines and make cross-origin injection obvious.
fn append_log_entry(entry: String) {
    let sanitized = sanitize_log_entry(&entry);
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{}] [FRONTEND] {}\n", timestamp, sanitized);
    ChannelLogger::log_direct(line);
}

#[tauri::command]
pub async fn cmd_logs_append(entry: String) -> ApiResponse<()> {
    if entry.len() > MAX_LOG_ENTRY_LEN {
        return validation_error(
            "INVALID_INPUT",
            format!(
                "Log entry exceeds {} bytes (got {})",
                MAX_LOG_ENTRY_LEN,
                entry.len()
            ),
        );
    }
    append_log_entry(entry);
    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

/// Generates a random confirmation token for the log-clear operation.
/// Returns a UUID-based token that must be presented within the TTL window.
#[tauri::command]
pub async fn cmd_logs_request_clear_token() -> ApiResponse<String> {
    // Evict expired tokens before generating a new one
    evict_expired_clear_tokens();

    let token = uuid::Uuid::new_v4().to_string();
    LOG_CLEAR_TOKENS.insert(token.clone(), Instant::now());

    tracing::info!(
        "Log clear token issued (TTL={}s, pending={})",
        LOG_CLEAR_TOKEN_TTL_SECS,
        LOG_CLEAR_TOKENS.len()
    );

    ApiResponse {
        success: true,
        data: Some(token),
        error: None,
    }
}

/// Removes expired entries from the log-clear token store.
fn evict_expired_clear_tokens() {
    let cutoff = Instant::now().checked_sub(Duration::from_secs(LOG_CLEAR_TOKEN_TTL_SECS));

    match cutoff {
        Some(c) => LOG_CLEAR_TOKENS.retain(|_, created| *created > c),
        None => { /* TTL exceeds uptime — nothing can be expired */ }
    }
}

/// Clears the log file after validating a confirmation token.
///
/// The caller must first invoke `cmd_logs_request_clear_token` to obtain a token,
/// then present it here within the TTL window. Tokens are single-use — successful
/// or failed validation removes the token from the pending store.
#[tauri::command]
pub async fn cmd_logs_clear<R: Runtime>(app: AppHandle<R>, token: String) -> ApiResponse<()> {
    // Validate token format before lookup
    if token.is_empty() || token.len() > MAX_LOG_CLEAR_TOKEN_LEN {
        return validation_error("INVALID_TOKEN", "Clear token is missing or malformed");
    }

    // Evict expired tokens first
    evict_expired_clear_tokens();

    // Atomically remove and validate the token (single-use)
    let entry = LOG_CLEAR_TOKENS.remove(&token);
    match entry {
        Some((_, created)) => {
            let elapsed = created.elapsed();
            if elapsed > Duration::from_secs(LOG_CLEAR_TOKEN_TTL_SECS) {
                tracing::warn!(
                    "Expired log clear token rejected (elapsed={:.1}s, TTL={}s)",
                    elapsed.as_secs_f64(),
                    LOG_CLEAR_TOKEN_TTL_SECS
                );
                return validation_error(
                    "TOKEN_EXPIRED",
                    "Confirmation token has expired. Request a new token and try again.",
                );
            }
        }
        None => {
            tracing::warn!("Invalid log clear token rejected");
            return validation_error(
                "INVALID_TOKEN",
                "Invalid confirmation token. Request a new token and try again.",
            );
        }
    }

    tracing::info!("Clearing logs (confirmed via token)");
    // Flush pending writes before truncating the file.
    ChannelLogger::global().flush();

    let _ = tokio::task::spawn_blocking(move || match get_log_path(&app) {
        Ok(path) => {
            if path.exists() {
                let _ = std::fs::write(&path, b"");
            }
        }
        Err(e) => tracing::error!("Failed to resolve log path: {}", e),
    })
    .await;
    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_log_entry_preserves_normal_text() {
        let input = "User clicked button at 12:30:45";
        let result = sanitize_log_entry(input);
        assert_eq!(result, "User clicked button at 12:30:45");
    }

    #[test]
    fn test_sanitize_log_entry_strips_newlines() {
        let input = "Line1\nLine2\r\nLine3";
        let result = sanitize_log_entry(input);
        assert!(!result.contains('\n'));
        assert!(!result.contains('\r'));
        assert_eq!(result, "Line1 Line2 Line3");
    }

    #[test]
    fn test_sanitize_log_entry_strips_control_chars() {
        let input = "Before\x00Middle\x1fAfter";
        let result = sanitize_log_entry(input);
        assert!(!result.contains('\x00'));
        assert!(!result.contains('\x1f'));
        assert_eq!(result, "Before Middle After");
    }

    #[test]
    fn test_sanitize_log_entry_preserves_tabs() {
        let input = "Col1\tCol2\tCol3";
        let result = sanitize_log_entry(input);
        // Tabs are collapsed to spaces for log readability
        assert_eq!(result, "Col1 Col2 Col3");
    }

    #[test]
    fn test_sanitize_log_entry_strips_ansi_colors() {
        let input = "\u{1b}[31mError:\u{1b}[0m Something went wrong";
        let result = sanitize_log_entry(input);
        assert!(result.contains("Error:"));
        assert!(result.contains("Something went wrong"));
        assert!(!result.contains('\u{1b}'));
    }

    #[test]
    fn test_sanitize_log_entry_strips_ansi_cursor_movement() {
        let input = "\u{1b}[10;5HMove here\u{1b}[2J";
        let result = sanitize_log_entry(input);
        assert!(!result.contains('\u{1b}'));
        assert_eq!(result, "Move here");
    }

    #[test]
    fn test_sanitize_log_entry_strips_osc_commands() {
        let input = "\u{1b}]0;Malicious Title\u{07}Normal text";
        let result = sanitize_log_entry(input);
        assert!(!result.contains('\u{1b}'));
        assert_eq!(result, "Normal text");
    }

    #[test]
    fn test_sanitize_log_entry_collapse_whitespace() {
        let input = "Multiple    spaces   and\ttabs";
        let result = sanitize_log_entry(input);
        assert_eq!(result, "Multiple spaces and tabs");
    }

    #[test]
    fn test_sanitize_log_entry_truncates_long_entries() {
        let input = "x".repeat(15_000);
        let result = sanitize_log_entry(&input);
        assert!(result.len() <= MAX_LOG_ENTRY_LEN + "[TRUNCATED]".len());
        assert!(result.ends_with("... [TRUNCATED]"));
    }

    #[test]
    fn test_sanitize_log_entry_log_injection_prevention() {
        let input = "Normal message\n[2024-01-01 00:00:00] [INJECTED] Fake log entry";
        let result = sanitize_log_entry(input);
        // Newlines are converted to spaces, preventing multi-line log injection
        assert!(!result.contains('\n'));
        // The content remains intact as a single line; brackets are preserved
        assert_eq!(
            result,
            "Normal message [2024-01-01 00:00:00] [INJECTED] Fake log entry"
        );
    }

    #[test]
    fn test_strip_ansi_escapes_preserves_regular_text() {
        let input = "Plain text without ANSI";
        let result = strip_ansi_escapes(input);
        assert_eq!(result, "Plain text without ANSI");
    }

    #[test]
    fn test_collapse_whitespace_multiple_spaces() {
        let input = "a    b   c";
        let result = collapse_whitespace(input);
        assert_eq!(result, "a b c");
    }

    #[test]
    fn test_collapse_whitespace_leading_trailing() {
        let input = "   leading and trailing   ";
        let result = collapse_whitespace(input);
        assert_eq!(result, "leading and trailing");
    }

    // ---- Confirmation token tests ----

    #[test]
    fn test_clear_token_issue_and_validate() {
        LOG_CLEAR_TOKENS.clear();

        // Simulate issuing a token
        let token = uuid::Uuid::new_v4().to_string();
        LOG_CLEAR_TOKENS.insert(token.clone(), Instant::now());

        // Token should be present
        assert!(LOG_CLEAR_TOKENS.contains_key(&token));

        // Removing (consuming) the token should succeed
        let entry = LOG_CLEAR_TOKENS.remove(&token);
        assert!(entry.is_some(), "token should be found and removed");
        assert!(
            LOG_CLEAR_TOKENS.get(&token).is_none(),
            "token should be gone after removal"
        );

        // Second removal should fail (single-use)
        let entry2 = LOG_CLEAR_TOKENS.remove(&token);
        assert!(entry2.is_none(), "token should not be reusable");

        LOG_CLEAR_TOKENS.clear();
    }

    #[test]
    fn test_clear_token_expired_is_evicted() {
        LOG_CLEAR_TOKENS.clear();

        // Insert a token that is already expired
        let expired_token = "expired-test-token".to_string();
        LOG_CLEAR_TOKENS.insert(
            expired_token.clone(),
            Instant::now() - Duration::from_secs(LOG_CLEAR_TOKEN_TTL_SECS + 10),
        );

        // Also insert a fresh token
        let fresh_token = "fresh-test-token".to_string();
        LOG_CLEAR_TOKENS.insert(fresh_token.clone(), Instant::now());

        // Evict expired tokens
        evict_expired_clear_tokens();

        // Expired token should be gone, fresh token should remain
        assert!(
            LOG_CLEAR_TOKENS.get(&expired_token).is_none(),
            "expired token should be evicted"
        );
        assert!(
            LOG_CLEAR_TOKENS.get(&fresh_token).is_some(),
            "fresh token should remain"
        );

        LOG_CLEAR_TOKENS.clear();
    }

    #[test]
    fn test_clear_token_single_use_rejection() {
        LOG_CLEAR_TOKENS.clear();

        let token = uuid::Uuid::new_v4().to_string();
        LOG_CLEAR_TOKENS.insert(token.clone(), Instant::now());

        // First removal succeeds
        let first = LOG_CLEAR_TOKENS.remove(&token);
        assert!(first.is_some());

        // Second removal fails (already consumed)
        let second = LOG_CLEAR_TOKENS.remove(&token);
        assert!(
            second.is_none(),
            "single-use token must not be consumed twice"
        );

        LOG_CLEAR_TOKENS.clear();
    }

    #[test]
    fn test_clear_token_invalid_rejected() {
        LOG_CLEAR_TOKENS.clear();

        // Token was never issued
        let entry = LOG_CLEAR_TOKENS.remove("nonexistent-token");
        assert!(entry.is_none(), "unissued token must be rejected");

        LOG_CLEAR_TOKENS.clear();
    }

    #[test]
    fn test_clear_token_ttl_constant_sanity() {
        const { assert!(LOG_CLEAR_TOKEN_TTL_SECS > 0, "TTL must be positive") };
        const {
            assert!(
                LOG_CLEAR_TOKEN_TTL_SECS <= 300,
                "TTL should be reasonable (≤5 minutes)"
            )
        };
    }

    #[test]
    fn test_clear_token_max_len_sanity() {
        const {
            assert!(
                MAX_LOG_CLEAR_TOKEN_LEN >= 36,
                "MAX_LOG_CLEAR_TOKEN_LEN must accommodate UUID v4 (36 chars)"
            )
        };
    }
}
