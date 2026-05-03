//! Error types for the Ollama command layer.
//!
//! This module re-exports error-related types from [`crate::payloads`] so that
//! submodules within `ollama::` can import them locally. No new error types are
//! defined here yet — the canonical definitions live in `payloads.rs`.

pub use crate::payloads::{ApiResponse, BackendError};
