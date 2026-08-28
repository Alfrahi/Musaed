//! Structured tracing domain module for Musaed.
//!
//! This module provides production-grade structured logging with trace context
//! propagation across IPC boundaries. It implements the observability model
//! defined in STANDARDS.md §14.
//!
//! ## Architecture
//!
//! ```text
//! Frontend (TypeScript) → IPC → Rust Commands → Tracing Domain → File + Console
//! ```
//!
//! ## Features
//!
//! - Trace ID propagation across IPC boundaries
//! - Span hierarchy with parent-child relationships
//! - Structured JSON logging with required fields:
//!   - traceId, spanId, parentSpanId
//!   - feature, action, level, status
//!   - latencyMs, timestamp, source
//!   - context (optional key-value metadata)
//! - Async-safe file writing with buffering
//! - Sanitization of sensitive data in log output

pub mod commands;

pub mod logger;

pub mod sanitizer;

pub mod service;

pub mod tokens;

pub use logger::{get_log_path, init_file_logger, ChannelLogger, TracingLayer};

pub use service::emit_trace;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;

// ============================================================================
// Type Definitions
// ============================================================================

/// Log level for structured trace entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl std::fmt::Display for LogLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LogLevel::Debug => write!(f, "DEBUG"),
            LogLevel::Info => write!(f, "INFO"),
            LogLevel::Warn => write!(f, "WARN"),
            LogLevel::Error => write!(f, "ERROR"),
        }
    }
}

/// Status of a completed trace span.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TraceStatus {
    Success,
    Error,
    Cancelled,
    Timeout,
}

impl std::fmt::Display for TraceStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TraceStatus::Success => write!(f, "success"),
            TraceStatus::Error => write!(f, "error"),
            TraceStatus::Cancelled => write!(f, "cancelled"),
            TraceStatus::Timeout => write!(f, "timeout"),
        }
    }
}

/// Source of a trace entry (where it originated).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TraceSource {
    Frontend,
    Backend,
    Ipc,
}

impl std::fmt::Display for TraceSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TraceSource::Frontend => write!(f, "frontend"),
            TraceSource::Backend => write!(f, "backend"),
            TraceSource::Ipc => write!(f, "ipc"),
        }
    }
}

/// Context for propagating trace metadata across IPC boundaries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceContext {
    pub trace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_span_id: Option<String>,
    pub feature: String,
    pub action: String,
}

/// A completed structured trace entry for observability.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceEntry {
    /// ISO 8601 timestamp of when the entry was created.
    pub timestamp: String,
    /// Unique identifier for the trace (groups related spans).
    pub trace_id: String,
    /// Unique identifier for this span.
    pub span_id: String,
    /// Optional parent span ID for nested trace hierarchies.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_span_id: Option<String>,
    /// Feature domain this trace belongs to (e.g., "chat", "rag", "ollama").
    pub feature: String,
    /// Action being performed (e.g., "sendMessage", "indexProject").
    pub action: String,
    /// Log level.
    pub level: LogLevel,
    /// Optional status for completed spans.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<TraceStatus>,
    /// Optional latency in milliseconds for completed spans.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    /// Human-readable message describing the event.
    pub message: String,
    /// Source of the trace entry.
    pub source: TraceSource,
    /// Optional contextual metadata as key-value pairs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<HashMap<String, serde_json::Value>>,
}

impl TraceEntry {
    /// Serializes the trace entry to a JSON string for logging.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

/// Input for creating a new trace entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceEntryInput {
    pub trace_id: String,
    #[serde(default)]
    pub span_id: Option<String>,
    #[serde(default)]
    pub parent_span_id: Option<String>,
    pub feature: String,
    pub action: String,
    pub level: LogLevel,
    #[serde(default)]
    pub status: Option<TraceStatus>,
    #[serde(default)]
    pub latency_ms: Option<u64>,
    pub message: String,
    pub source: TraceSource,
    #[serde(default)]
    pub context: Option<HashMap<String, serde_json::Value>>,
}

// ============================================================================
// Active Trace Registry
// ============================================================================

/// Registry for active spans, allowing lookup by trace_id for context propagation.
/// Maps trace_id → (span_id, feature, action)
static ACTIVE_SPANS: LazyLock<DashMap<String, (String, String, String)>> =
    LazyLock::new(DashMap::new);
