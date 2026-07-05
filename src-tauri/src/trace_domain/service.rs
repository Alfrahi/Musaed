// Thin‑adapter service layer for Trace Domain commands.
// All business logic (validation, span handling, logging) lives here.

use crate::generated_validation::{
    MAX_ACTION_NAME_LEN, MAX_FEATURE_NAME_LEN, MAX_TRACE_CONTEXT_FIELDS,
    MAX_TRACE_CONTEXT_VALUE_LEN, MAX_TRACE_MESSAGE_LEN,
};
use crate::payloads::{ApiResponse, BackendError};
use crate::trace_domain::{
    LogLevel, Span, TraceContext, TraceEntry, TraceEntryInput, TraceSource, TraceStatus,
    ACTIVE_SPANS,
};
use chrono::Utc;
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

// ---------------------------------------------------------------------
// Private validation helpers
// ---------------------------------------------------------------------

/// Validates that a string length is within the provided inclusive bounds.
fn validate_length(s: &str, min: usize, max: usize) -> bool {
    let len = s.len();
    len >= min && len <= max
}

/// Validates a TraceEntryInput against all constraints.
fn validate_trace_input(input: &TraceEntryInput) -> Result<(), String> {
    // trace_id format (simple length check, real UUID validation handled later)
    if input.trace_id.is_empty() || input.trace_id.len() > 36 {
        return Err(format!(
            "trace_id must be a valid UUID (got {} chars)",
            input.trace_id.len()
        ));
    }
    // feature name
    if !validate_length(&input.feature, 1, MAX_FEATURE_NAME_LEN) {
        return Err(format!(
            "feature name must be 1-{} characters (got {})",
            MAX_FEATURE_NAME_LEN,
            input.feature.len()
        ));
    }
    // action name
    if !validate_length(&input.action, 1, MAX_ACTION_NAME_LEN) {
        return Err(format!(
            "action name must be 1-{} characters (got {})",
            MAX_ACTION_NAME_LEN,
            input.action.len()
        ));
    }
    // message
    if !validate_length(&input.message, 1, MAX_TRACE_MESSAGE_LEN) {
        return Err(format!(
            "message must be 1-{} characters (got {})",
            MAX_TRACE_MESSAGE_LEN,
            input.message.len()
        ));
    }
    // context field count
    if let Some(ctx) = &input.context {
        if ctx.len() > MAX_TRACE_CONTEXT_FIELDS {
            return Err(format!(
                "context must have ≤{} fields (got {})",
                MAX_TRACE_CONTEXT_FIELDS,
                ctx.len()
            ));
        }
        // each context value length
        for (key, value) in ctx {
            if !validate_length(key, 1, MAX_FEATURE_NAME_LEN) {
                return Err(format!("context key '{}' exceeds length limit", key));
            }
            if let Value::String(s) = value {
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

/// Emits a trace entry to the logging channel (used by all command‑related operations).
pub fn emit_trace(entry: TraceEntry) {
    // Serialize to JSON
    let json = match entry.to_json() {
        Ok(j) => j,
        Err(e) => {
            eprintln!("[TRACE ERROR] Failed to serialize trace entry: {}", e);
            return;
        }
    };

    // Log through the channel logger (project‑wide logger)
    crate::trace_domain::logger::ChannelLogger::log_direct(format!("{}\n", json));

    // Optionally echo to console in debug builds
    #[cfg(debug_assertions)]
    {
        match entry.level {
            LogLevel::Error => eprintln!(
                "[TRACE:ERROR] {}:{} - {}",
                entry.feature, entry.action, entry.message
            ),
            LogLevel::Warn => eprintln!(
                "[TRACE:WARN] {}:{} - {}",
                entry.feature, entry.action, entry.message
            ),
            LogLevel::Info => println!(
                "[TRACE:INFO] {}:{} - {}",
                entry.feature, entry.action, entry.message
            ),
            LogLevel::Debug => println!(
                "[TRACE:DEBUG] {}:{} - {}",
                entry.feature, entry.action, entry.message
            ),
        }
    }
}

// ---------------------------------------------------------------------
// Public service functions – thin‑adapter entry points for the Tauri commands
// ---------------------------------------------------------------------

/// Append a structured trace entry (frontend entry point).
pub async fn append(input: TraceEntryInput) -> ApiResponse<()> {
    // Validate input first
    if let Err(e) = validate_trace_input(&input) {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("VALIDATION_ERROR", e)),
        };
    }

    // Ensure we have a span_id (generate if missing)
    let span_id = input.span_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let entry = TraceEntry {
        timestamp: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
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

    emit_trace(entry);
    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

/// Start a new trace span and return its context.
pub async fn start(trace_id: String, feature: String, action: String) -> ApiResponse<TraceContext> {
    // Basic validation – reuse the same length checks as above
    if trace_id.is_empty() || trace_id.len() > 36 {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                "INVALID_TRACE_ID",
                "trace_id must be a valid UUID",
            )),
        };
    }
    if !validate_length(&feature, 1, MAX_FEATURE_NAME_LEN) {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                "INVALID_FEATURE",
                format!("feature must be 1-{} chars", MAX_FEATURE_NAME_LEN),
            )),
        };
    }
    if !validate_length(&action, 1, MAX_ACTION_NAME_LEN) {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                "INVALID_ACTION",
                format!("action must be 1-{} chars", MAX_ACTION_NAME_LEN),
            )),
        };
    }

    // Register the span in the global registry
    let _span = Span::new(trace_id.clone(), feature.clone(), action.clone(), None);

    let context = TraceContext {
        trace_id,
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

/// Complete an active trace span.
pub async fn complete(
    trace_id: String,
    status: TraceStatus,
    message: Option<String>,
    context: Option<HashMap<String, Value>>,
) -> ApiResponse<()> {
    // Lookup the active span
    let entry = ACTIVE_SPANS.get(&trace_id);
    if entry.is_none() {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                "SPAN_NOT_FOUND",
                format!("No active span found for trace_id '{}'", trace_id),
            )),
        };
    }

    let (span_id, feature, action) = entry.as_ref().unwrap().value().clone();
    // Drop the entry before we emit (avoid holding the lock during IO)
    drop(entry);

    let latency_ms = 0; // Precise latency not tracked here
    let trace_entry = TraceEntry {
        timestamp: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        trace_id: trace_id.clone(),
        span_id,
        parent_span_id: None,
        feature,
        action,
        level: match status {
            TraceStatus::Success => LogLevel::Info,
            TraceStatus::Error => LogLevel::Error,
            TraceStatus::Cancelled => LogLevel::Warn,
            TraceStatus::Timeout => LogLevel::Debug,
        },
        status: Some(status),
        latency_ms: Some(latency_ms),
        message: message.unwrap_or_else(|| "span completed".to_string()),
        source: TraceSource::Backend,
        context,
    };

    emit_trace(trace_entry);
    // Remove the span from the global registry
    ACTIVE_SPANS.remove(&trace_id);

    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

/// Get the current trace context for an active trace.
pub async fn get_context(trace_id: String) -> ApiResponse<TraceContext> {
    let entry = ACTIVE_SPANS.get(&trace_id);
    if entry.is_none() {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
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
