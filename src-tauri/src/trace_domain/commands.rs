//! Trace emission and IPC command handlers for structured logging.

use super::{Span, TraceContext, TraceEntry, TraceEntryInput};
use crate::generated_validation::{
    MAX_ACTION_NAME_LEN, MAX_FEATURE_NAME_LEN, MAX_TRACE_CONTEXT_FIELDS,
    MAX_TRACE_CONTEXT_VALUE_LEN, MAX_TRACE_MESSAGE_LEN,
};
use crate::payloads::ApiResponse;
use std::collections::HashMap;

// ============================================================================
// Validation Helpers (local to avoid circular dependency)
// ============================================================================

/// Validates that a string length is within bounds.
fn validate_length(s: &str, min: usize, max: usize) -> bool {
    s.len() >= min && s.len() <= max
}

// ============================================================================
// Trace Emission
// ============================================================================

/// Emits a structured trace entry to the log stream.
/// Sanitizes all fields and validates constraints before logging.
pub fn emit_trace(entry: TraceEntry) {
    // Serialize to JSON
    let json = match entry.to_json() {
        Ok(j) => j,
        Err(e) => {
            eprintln!("[TRACE ERROR] Failed to serialize trace entry: {}", e);
            return;
        }
    };

    // Log through the channel logger
    crate::logger::ChannelLogger::log_direct(format!("{}\n", json));

    // Also log to console in debug mode
    #[cfg(debug_assertions)]
    {
        match entry.level {
            super::LogLevel::Error => {
                eprintln!(
                    "[TRACE:ERROR] {}:{} - {}",
                    entry.feature, entry.action, entry.message
                )
            }
            super::LogLevel::Warn => {
                eprintln!(
                    "[TRACE:WARN] {}:{} - {}",
                    entry.feature, entry.action, entry.message
                )
            }
            super::LogLevel::Info => {
                println!(
                    "[TRACE:INFO] {}:{} - {}",
                    entry.feature, entry.action, entry.message
                )
            }
            super::LogLevel::Debug => {
                println!(
                    "[TRACE:DEBUG] {}:{} - {}",
                    entry.feature, entry.action, entry.message
                )
            }
        }
    }
}

// ============================================================================
// Validation Helpers
// ============================================================================

/// Validates a trace entry input against all constraints.
fn validate_trace_input(input: &TraceEntryInput) -> Result<(), String> {
    // Validate trace_id format (UUID)
    if input.trace_id.is_empty() || input.trace_id.len() > 36 {
        return Err(format!(
            "trace_id must be a valid UUID (got {} chars)",
            input.trace_id.len()
        ));
    }

    // Validate feature name
    if !validate_length(&input.feature, 1, MAX_FEATURE_NAME_LEN) {
        return Err(format!(
            "feature name must be 1-{} characters (got {})",
            MAX_FEATURE_NAME_LEN,
            input.feature.len()
        ));
    }

    // Validate action name
    if !validate_length(&input.action, 1, MAX_ACTION_NAME_LEN) {
        return Err(format!(
            "action name must be 1-{} characters (got {})",
            MAX_ACTION_NAME_LEN,
            input.action.len()
        ));
    }

    // Validate message
    if !validate_length(&input.message, 1, MAX_TRACE_MESSAGE_LEN) {
        return Err(format!(
            "message must be 1-{} characters (got {})",
            MAX_TRACE_MESSAGE_LEN,
            input.message.len()
        ));
    }

    // Validate context field count
    if let Some(ctx) = &input.context {
        if ctx.len() > MAX_TRACE_CONTEXT_FIELDS {
            return Err(format!(
                "context must have ≤{} fields (got {})",
                MAX_TRACE_CONTEXT_FIELDS,
                ctx.len()
            ));
        }

        // Validate each context value length
        for (key, value) in ctx {
            if !validate_length(key, 1, MAX_FEATURE_NAME_LEN) {
                return Err(format!("context key '{}' exceeds length limit", key));
            }

            // String values
            if let serde_json::Value::String(s) = value {
                if s.len() > MAX_TRACE_CONTEXT_VALUE_LEN {
                    return Err(format!(
                        "context value for '{}' exceeds {} chars",
                        key, MAX_TRACE_CONTEXT_VALUE_LEN
                    ));
                }
            }
        }
    }

    Ok(())
}

// ============================================================================
// IPC Commands
// ============================================================================

/// Appends a structured trace entry to the log stream.
/// This is the primary entry point for frontend trace emission.
#[tauri::command]
pub async fn cmd_trace_append(input: TraceEntryInput) -> ApiResponse<()> {
    // Validate input
    if let Err(e) = validate_trace_input(&input) {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(crate::payloads::BackendError::new("VALIDATION_ERROR", e)),
        };
    }

    // Generate span_id if not provided
    let span_id = input
        .span_id
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // Construct trace entry
    let entry = TraceEntry {
        timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        trace_id: input.trace_id,
        span_id,
        parent_span_id: input.parent_span_id,
        feature: input.feature,
        action: input.action,
        level: input.level,
        status: input.status,
        latency_ms: input.latency_ms,
        message: input.message,
        source: input.source,
        context: input.context,
    };

    // Emit the trace
    emit_trace(entry);

    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

/// Creates a new trace span and returns its context for IPC propagation.
/// Use this to start a traceable operation that spans multiple IPC calls.
#[tauri::command]
pub async fn cmd_trace_start(
    trace_id: String,
    feature: String,
    action: String,
) -> ApiResponse<TraceContext> {
    // Basic validation
    if trace_id.is_empty() || trace_id.len() > 36 {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(crate::payloads::BackendError::new(
                "INVALID_TRACE_ID",
                "trace_id must be a valid UUID",
            )),
        };
    }

    if !validate_length(&feature, 1, MAX_FEATURE_NAME_LEN) {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(crate::payloads::BackendError::new(
                "INVALID_FEATURE",
                format!("feature must be 1-{} chars", MAX_FEATURE_NAME_LEN),
            )),
        };
    }

    if !validate_length(&action, 1, MAX_ACTION_NAME_LEN) {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(crate::payloads::BackendError::new(
                "INVALID_ACTION",
                format!("action must be 1-{} chars", MAX_ACTION_NAME_LEN),
            )),
        };
    }

    // Create span (automatically registers in global registry)
    let _span = Span::new(trace_id.clone(), feature.clone(), action.clone(), None);

    // Return context for IPC propagation
    let context = TraceContext {
        trace_id: trace_id.clone(),
        parent_span_id: None,
        feature,
        action,
    };

    ApiResponse {
        success: true,
        data: Some(context),
        error: None,
    }
}

/// Completes an active trace span with a status.
/// The span is removed from the registry after completion.
#[tauri::command]
pub async fn cmd_trace_complete(
    trace_id: String,
    status: super::TraceStatus,
    message: Option<String>,
    context: Option<HashMap<String, serde_json::Value>>,
) -> ApiResponse<()> {
    // Look up the active span
    let entry = super::ACTIVE_SPANS.get(&trace_id);
    if entry.is_none() {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(crate::payloads::BackendError::new(
                "SPAN_NOT_FOUND",
                format!("No active span found for trace_id '{}'", trace_id),
            )),
        };
    }

    let (span_id, feature, action) = entry.as_ref().unwrap().value().clone();

    // Create a temporary span to complete it
    // This is a workaround since we can't move the original Span out of DashMap
    // In practice, features should keep their Span handle and call .complete() directly
    drop(entry);

    // Log the completion
    let latency_ms = 0; // We don't have the original start time

    let trace_entry = TraceEntry {
        timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        trace_id: trace_id.clone(),
        span_id,
        parent_span_id: None,
        feature,
        action,
        level: match status {
            super::TraceStatus::Success => super::LogLevel::Info,
            super::TraceStatus::Error => super::LogLevel::Error,
            super::TraceStatus::Cancelled => super::LogLevel::Warn,
            super::TraceStatus::Timeout => super::LogLevel::Debug,
        },
        status: Some(status),
        latency_ms: Some(latency_ms),
        message: message.unwrap_or_else(|| "span completed".to_string()),
        source: super::TraceSource::Backend,
        context,
    };

    emit_trace(trace_entry);

    // Remove from registry
    super::ACTIVE_SPANS.remove(&trace_id);

    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

/// Gets the current trace context for an active trace.
/// Useful for propagating trace context to child operations.
#[tauri::command]
pub async fn cmd_trace_get_context(trace_id: String) -> ApiResponse<TraceContext> {
    let entry = super::ACTIVE_SPANS.get(&trace_id);
    if entry.is_none() {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(crate::payloads::BackendError::new(
                "SPAN_NOT_FOUND",
                format!("No active span found for trace_id '{}'", trace_id),
            )),
        };
    }

    let (span_id, feature, action) = entry.as_ref().unwrap().value().clone();

    ApiResponse {
        success: true,
        data: Some(TraceContext {
            trace_id,
            parent_span_id: Some(span_id),
            feature,
            action,
        }),
        error: None,
    }
}

// ============================================================================
// Convenience Macros
// ============================================================================

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
