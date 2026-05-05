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

pub mod client;
pub mod commands;
pub mod error;
pub mod models;
pub mod streaming;
pub mod title;
pub mod types;

// ---- Public re-exports: every Tauri command is available as `ollama::<name>` ----

pub use commands::{abort_chat, chat_with_ollama, check_ollama_health};
pub use models::{
    abort_pull, delete_model, get_ollama_models, pull_model, validate_model, verify_ollama_service,
};
pub use title::generate_title;

// ---- Internal helpers (used by tests within this module) ----
#[cfg(test)]
use title::strip_thinking_blocks;

// ==================== TESTS ====================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::payloads::ChatMessage;
    use crate::shared::{
        ABORT_HANDLES, MAX_TOTAL_IMAGE_SIZE_BYTES, PULL_ABORT_HANDLES, REQUEST_CACHE,
    };
    use dashmap::mapref::entry::Entry;
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
        let messages = make_messages_with_images(vec![MAX_TOTAL_IMAGE_SIZE_BYTES]);
        let total_b64_len: usize = messages
            .iter()
            .filter_map(|m| m.images.as_ref())
            .flatten()
            .map(|s| s.len())
            .sum();
        assert!(total_b64_len > MAX_TOTAL_IMAGE_SIZE_BYTES * 4 / 3 + 1024);
    }

    #[tokio::test]
    async fn duplicate_request_detected() {
        let req_id = "test-dup-req".to_string();
        REQUEST_CACHE.insert(req_id.clone(), Instant::now());

        let entry = REQUEST_CACHE.entry(req_id.clone());
        assert!(matches!(entry, Entry::Occupied(_)));

        REQUEST_CACHE.remove(&req_id);
    }

    #[tokio::test]
    async fn abort_cancels_token() {
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
        let messages = vec![ChatMessage {
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

    #[tokio::test]
    async fn abort_pull_cancels_token() {
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
    async fn abort_pull_handles_nonexistent_model() {
        let result = models::abort_pull("nonexistent".to_string()).await;
        assert!(result.success);
    }

    // ---- strip_thinking_blocks tests ----

    #[test]
    fn strip_redacted_thinking_block() {
        let input = "<redacted-thinking>some reasoning</redacted-thinking>Hello World";
        assert_eq!(strip_thinking_blocks(input), "Hello World");
    }

    #[test]
    fn strip_thinkigne_block() {
        let input = "<thinkigne>reasoning</thinkigne>Title Here";
        assert_eq!(strip_thinking_blocks(input), "Title Here");
    }

    #[test]
    fn strip_lemma_block() {
        let input = "<lemma>math</lemma>Final Answer";
        assert_eq!(strip_thinking_blocks(input), "Final Answer");
    }

    #[test]
    fn strip_takes_last_nonempty_line() {
        let input = "line one\nline two\n  \nfinal line";
        assert_eq!(strip_thinking_blocks(input), "final line");
    }

    #[test]
    fn strip_unclosed_tag_removes_everything_after() {
        let input = "before<redacted-thinking>no closing tag";
        assert_eq!(strip_thinking_blocks(input), "before");
    }

    #[test]
    fn strip_empty_input() {
        assert_eq!(strip_thinking_blocks(""), "");
    }

    #[test]
    fn strip_no_tags_returns_trimmed() {
        assert_eq!(strip_thinking_blocks("  plain text  "), "plain text");
    }
}
