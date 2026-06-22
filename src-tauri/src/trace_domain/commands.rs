//! Thin‑adapter command handlers for Trace Domain.
//! Business logic (validation, span management, logging) is delegated to
//! `crate::trace_domain::service`.

use super::{TraceContext, TraceEntryInput, TraceStatus};
use crate::payloads::ApiResponse;
use std::collections::HashMap;

// ---------------------------------------------------------------------
// IPC command thin adapters
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
