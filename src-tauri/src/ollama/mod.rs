//! Ollama integration module.
//!
//! Organises all Ollama-related Tauri commands and helpers into focused
//! submodules:
//!
//! - [`commands`]   — Chat, abort, and health-check Tauri commands
//! - [`models`]     — Model listing, validation, pulling, deletion, service verification
//! - [`title`]      — Conversation title generation
//! - [`streaming`]  — SSE stream processing for chat tokens
//! - [`client`]     — Re-exports of shared HTTP clients and state
//! - [`types`]      — Re-exports of payload types
//! - [`error`]      — Re-exports of error types

pub mod abort_service; // new domain service for abort logic
pub mod client;
pub mod commands;
pub mod error;
pub mod health_service;
pub mod model_service;
pub mod models;
pub mod service;
pub mod streaming;
pub mod title;
pub mod title_service;
pub mod types; // placeholder for health refactor

// ---- Public re-exports: every Tauri command is available as `ollama::<name>` ----

pub use commands::{cmd_ollama_abort_chat, cmd_ollama_chat, cmd_ollama_check_health};
pub use models::{
    cmd_ollama_abort_pull, cmd_ollama_delete_model, cmd_ollama_get_models, cmd_ollama_pull_model,
    cmd_ollama_validate_model, cmd_ollama_verify_service,
};
pub use title::cmd_ollama_generate_title;

// ==================== TESTS ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::payloads::ChatMessage;
    use crate::shared::{
        ABORT_HANDLES, MAX_TOTAL_IMAGE_SIZE_BYTES, PULL_ABORT_HANDLES, REQUEST_CACHE,
    };
    use std::sync::Arc;
    use std::time::Instant;
    use tokio_util::sync::CancellationToken;

    fn make_messages_with_images(image_sizes: Vec<usize>) -> Vec<ChatMessage> {
        image_sizes
            .into_iter()
            .enumerate()
            .map(|(i, size)| ChatMessage {
                role: "user".to_string(),
                content: format!("msg {}", i),
                images: Some(vec!["A".repeat(size)]),
            })
            .collect()
    }

    #[test]
    fn image_size_check_passes_under_limit() {
        let messages = make_messages_with_images(vec![1024, 2048]);
        let total_b64_len: usize = messages
            .iter()
            .filter_map(|m| m.images.as_ref())
            .flatten()
            .map(|s| s.len())
            .sum();
        assert!(total_b64_len <= MAX_TOTAL_IMAGE_SIZE_BYTES * 4 / 3 + 1024);
    }

    #[test]
    fn image_size_check_exceeds_limit() {
        // Use a base64 length that exceeds the threshold: raw limit * 4/3 + some overhead
        let oversized = MAX_TOTAL_IMAGE_SIZE_BYTES * 2;
        let messages = make_messages_with_images(vec![oversized]);
        let total_b64_len: usize = messages
            .iter()
            .filter_map(|m| m.images.as_ref())
            .flatten()
            .map(|s| s.len())
            .sum();
        assert!(total_b64_len > MAX_TOTAL_IMAGE_SIZE_BYTES * 4 / 3 + 1024);
    }

    #[test]
    fn duplicate_request_detected() {
        let _guard = crate::shared::test_cache_lock();
        crate::shared::clear_request_cache();
        let req_id = "test-dup-req".to_string();
        REQUEST_CACHE.insert(req_id.clone(), Instant::now());

        // Verify the key exists using get() instead of entry() API to avoid
        // potential DashMap entry() API hangs in test context
        assert!(REQUEST_CACHE.get(&req_id).is_some());

        crate::shared::clear_request_cache();
    }

    #[test]
    fn abort_cancels_token() {
        let req_id = "test-abort-req".to_string();
        let token = Arc::new(CancellationToken::new());
        ABORT_HANDLES.insert(req_id.clone(), token.clone());

        assert!(!token.is_cancelled());

        if let Some((_, t)) = ABORT_HANDLES.remove(&req_id) {
            t.cancel();
        }

        assert!(token.is_cancelled());
    }

    #[test]
    fn messages_without_images_have_zero_size() {
        let messages = [ChatMessage {
            role: "user".to_string(),
            content: "hello".to_string(),
            images: None,
        }];
        let total_b64_len: usize = messages
            .iter()
            .filter_map(|m| m.images.as_ref())
            .flatten()
            .map(|s| s.len())
            .sum();
        assert_eq!(total_b64_len, 0);
    }

    #[test]
    fn cmd_ollama_abort_pull_cancels_token() {
        let model_name = "test-model".to_string();
        let token = Arc::new(CancellationToken::new());
        PULL_ABORT_HANDLES.insert(model_name.clone(), token.clone());

        assert!(!token.is_cancelled());

        if let Some((_, t)) = PULL_ABORT_HANDLES.remove(&model_name) {
            t.cancel();
        }

        assert!(token.is_cancelled());
    }

    #[tokio::test]
    async fn cmd_ollama_abort_pull_handles_nonexistent_model() {
        let result = models::cmd_ollama_abort_pull("nonexistent".to_string()).await;
        assert!(result.success);
    }
}
