//! Thin‑adapter command handlers for Trace Domain.
//! Business logic (validation, span management, logging) is delegated to
//! `crate::trace_domain::service`.

use super::{
    logger::{self, ChannelLogger},
    TraceContext, TraceEntryInput, TraceStatus,
};
use crate::payloads::ApiResponse;
use crate::validation::{validation_error, MAX_LOG_CLEAR_TOKEN_LEN, MAX_LOG_ENTRY_LEN};
use dashmap::DashMap;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tracing;

// ============================================================================
// Log Clear Token Management
// ============================================================================

/// Time-to-live for a log-clear confirmation token (seconds).
const LOG_CLEAR_TOKEN_TTL_SECS: u64 = 30;

/// Pending confirmation tokens for destructive log-clear operations.
/// Maps token string → creation instant. Tokens are single-use and TTL-bounded.
static LOG_CLEAR_TOKENS: LazyLock<DashMap<String, Instant>> = LazyLock::new(DashMap::new);

/// Removes expired entries from the log-clear token store.
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

// ---------------------------------------------------------------------
// IPC command thin adapters
// ---------------------------------------------------------------------

// ============================================================================
// Log Management Commands
// ============================================================================

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
    if collapsed.chars().count() > MAX_LOG_ENTRY_LEN {
        format!(
            "{}... [TRUNCATED]",
            &collapsed
                .chars()
                .take(MAX_LOG_ENTRY_LEN.saturating_sub(15))
                .collect::<String>()
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

/// Routes a frontend log entry through the async channel logger.
/// Entries are prefixed with `[FRONTEND]` to distinguish them from backend
/// log lines and make cross-origin injection obvious.
fn append_log_entry(entry: String) {
    let sanitized = sanitize_log_entry(&entry);
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{}] [FRONTEND] {}\n", timestamp, sanitized);
    ChannelLogger::log_direct(line);
}

/// Append a log entry from the frontend.
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

/// Clears the log file after validating a confirmation token.
///
/// The caller must first invoke `cmd_logs_request_clear_token` to obtain a token,
/// then present it here within the TTL window. Tokens are single-use — successful
/// or failed validation removes the token from the pending store.
#[tauri::command]
pub async fn cmd_logs_clear<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    token: String,
) -> ApiResponse<()> {
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

    let _ = tokio::task::spawn_blocking(move || match logger::get_log_path(&app) {
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

// ---------------------------------------------------------------------
// Trace domain commands
// ---------------------------------------------------------------------

/// Append a structured trace entry (frontend entry point).
#[tauri::command]
pub async fn cmd_trace_append(input: TraceEntryInput) -> ApiResponse<()> {
    crate::trace_domain::service::append(input).await
}

/// Start a new trace span and return its context for IPC propagation.
#[tauri::command]
pub async fn cmd_trace_start(
    trace_id: String,
    feature: String,
    action: String,
) -> ApiResponse<TraceContext> {
    crate::trace_domain::service::start(trace_id, feature, action).await
}

/// Complete an active trace span with a status.
#[tauri::command]
pub async fn cmd_trace_complete(
    trace_id: String,
    status: TraceStatus,
    message: Option<String>,
    context: Option<HashMap<String, serde_json::Value>>,
) -> ApiResponse<()> {
    crate::trace_domain::service::complete(trace_id, status, message, context).await
}

/// Get the current trace context for an active trace.
#[tauri::command]
pub async fn cmd_trace_get_context(trace_id: String) -> ApiResponse<TraceContext> {
    crate::trace_domain::service::get_context(trace_id).await
}

// ---------------------------------------------------------------------
// Convenience macro – unchanged from original implementation.
// ---------------------------------------------------------------------

/// Macro for wrapping an async operation with trace span lifecycle management.
///
/// Usage:
/// ```rust,no_run
/// let result = trace_async!(
///     "feature_name",
///     "action_name",
///     { /* your async code here */ },
///     |result| match result {
///         Ok(_) => Some("operation succeeded".to_string()),
///         Err(_) => Some("operation failed".to_string()),
///     }
/// ).await;
/// ```
#[macro_export]
macro_rules! trace_async {
    ($feature:expr, $action:expr, $block:block, $message_fn:expr) => {{
        use uuid::Uuid;
        use $crate::tracing::{Span, TraceStatus};

        let trace_id = Uuid::new_v4().to_string();
        let span = Span::new(trace_id, $feature.to_string(), $action.to_string(), None);
        let span_id = span.span_id().to_string();

        let result = (|| $block)();

        // Complete the span based on result
        match &result {
            Ok(_) => {
                let msg = ($message_fn)(&result);
                span.success(msg, None);
            }
            Err(_) => {
                let msg = ($message_fn)(&result);
                span.error(msg.unwrap_or_else(|| "operation failed".to_string()), None);
            }
        }

        result
    }};
}
