//! Shared types used across Ollama command handlers.
//!
//! All concrete struct/enum definitions live in [`crate::payloads`]. This
//! module re-exports them under the `ollama` namespace so that submodules can
//! `use super::types::*` without reaching across crate modules directly.

pub use crate::payloads::{
    ChatMessage, ChatOptions, ModelValidation, OllamaHealth, OllamaModel, OllamaToken,
    PullProgress, PullStreamError,
};
