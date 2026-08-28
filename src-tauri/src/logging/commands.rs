//! Thin-adapter command handlers for Trace Domain.
//!
//! All business logic — sanitization, span management, token TTL, log writing
//! — is delegated to sibling modules (`sanitizer`, `tokens`, `service`,
//! `logger`). Each `#[tauri::command]` here is a thin adapter per
//! STANDARDS.md §6: validate inputs at the boundary, delegate, return the
//! ApiResponse. No business logic lives in this file.

use super::{
    logger::ChannelLogger,
    sanitizer,
    tokens::{self, TokenValidation},
    TraceContext, TraceEntryInput, TraceStatus,
};
use crate::payloads::ApiResponse;
use crate::validation::{validation_error, MAX_LOG_CLEAR_TOKEN_LEN, MAX_LOG_ENTRY_LEN};
use std::collections::HashMap;
use tracing;

// ---------------------------------------------------------------------------
// Log Management Commands
// ---------------------------------------------------------------------------

/// Routes a frontend log entry through the async channel logger.
/// Entries are prefixed with `[FRONTEND]` to distinguish them from backend
/// log lines and make cross-origin injection obvious.
fn append_log_entry(entry: String) {
    let sanitized = sanitizer::sanitize_log_entry(&entry);
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
    let token = tokens::request_token();
    // tokens::request_token already emits a tracing::info line with TTL + pending
    // count; the command adapter stays silent to avoid duplicate log noise.
    ApiResponse {
        success: true,
        data: Some(token),
        error: None,
    }
}

/// Clears the log file after validating a confirmation token.
///
/// The caller must first invoke `cmd_logs_request_clear_token` to obtain a
/// token, then present it here within the TTL window. Tokens are single-use —
/// successful or failed validation removes the token from the pending store.
#[tauri::command]
pub async fn cmd_logs_clear<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    token: String,
) -> ApiResponse<()> {
    // Validate token format before lookup
    if token.is_empty() || token.len() > MAX_LOG_CLEAR_TOKEN_LEN {
        return validation_error("INVALID_TOKEN", "Clear token is missing or malformed");
    }

    match tokens::validate_token(&token) {
        TokenValidation::Valid { elapsed } => {
            tracing::info!(
                "Clearing logs (confirmed via token, elapsed={:.1}s)",
                elapsed.as_secs_f64()
            );
        }
        TokenValidation::Expired => {
            // validate_token already logs the rejection; return the IPC error.
            return validation_error(
                "TOKEN_EXPIRED",
                "Confirmation token has expired. Request a new token and try again.",
            );
        }
        TokenValidation::NotFound => {
            return validation_error(
                "INVALID_TOKEN",
                "Invalid confirmation token. Request a new token and try again.",
            );
        }
    }

    // Flush pending writes before truncating the file.
    ChannelLogger::global().flush();

    let _ = tokio::task::spawn_blocking(move || match super::logger::get_log_path(&app) {
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

// ---------------------------------------------------------------------------
// Trace domain commands
// ---------------------------------------------------------------------------

/// Append a structured trace entry (frontend entry point).
#[tauri::command]
pub async fn cmd_trace_append(input: TraceEntryInput) -> ApiResponse<()> {
    crate::logging::service::append(input).await
}

/// Start a new trace span and return its context for IPC propagation.
#[tauri::command]
pub async fn cmd_trace_start(
    trace_id: String,
    feature: String,
    action: String,
) -> ApiResponse<TraceContext> {
    crate::logging::service::start(trace_id, feature, action).await
}

/// Complete an active trace span with a status.
#[tauri::command]
pub async fn cmd_trace_complete(
    trace_id: String,
    status: TraceStatus,
    message: Option<String>,
    context: Option<HashMap<String, serde_json::Value>>,
) -> ApiResponse<()> {
    crate::logging::service::complete(trace_id, status, message, context).await
}

/// Get the current trace context for an active trace.
#[tauri::command]
pub async fn cmd_trace_get_context(trace_id: String) -> ApiResponse<TraceContext> {
    crate::logging::service::get_context(trace_id).await
}
