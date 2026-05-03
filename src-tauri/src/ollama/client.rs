//! HTTP client helpers and shared state for Ollama requests.
//!
//! The actual `reqwest::Client` instances, semaphores, and caches are defined
//! in [`crate::shared`]. This module re-exports the subset needed by the
//! `ollama` command layer so each submodule can keep its imports tidy.

pub use crate::shared::{
    acquire_global_permit, invalid_ollama_base, ollama_endpoint, retry_with_backoff,
    ABORT_HANDLES, CONCURRENT_SEMAPHORE, EVENT_OLLAMA_ERROR, EVENT_OLLAMA_TOKEN,
    EVENT_PULL_ERROR, EVENT_PULL_PROGRESS, FAST_HTTP_CLIENT, FAST_TIMEOUT_SECS, HTTP_CLIENT,
    INITIAL_REQUEST_TIMEOUT_SECS, MAX_TOTAL_IMAGE_SIZE_BYTES, PULL_ABORT_HANDLES,
    PULL_ABSOLUTE_TIMEOUT_SECS, REQUEST_CACHE, STREAM_ABSOLUTE_TIMEOUT_SECS,
    STREAM_IDLE_TIMEOUT_SECS,
};
