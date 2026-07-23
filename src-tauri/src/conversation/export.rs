//! Markdown export for conversations.
//!
//! Holds the rendering business logic that turns a stored conversation into a
//! Markdown document. Pulled out of the legacy root-level `export.rs` to keep
//! command handlers thin per STANDARDS.md §6 — the command adapter itself
//! lives in `conversation::commands`.

use crate::conversation::models::Conversation;
use crate::conversation::store::ConversationStore;
use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Formats a line range for display in markdown.
pub(crate) fn format_line_range(start: u32, end: u32) -> String {
    if start == end {
        format!("l{}", start)
    } else {
        format!("l{}-l{}", start, end)
    }
}

/// Formats a conversation as Markdown for export.
///
/// # Arguments
/// * `conversation` - The conversation to format
///
/// # Returns
/// Formatted Markdown string
pub(crate) fn format_conversation_as_markdown(conversation: &Conversation) -> String {
    let mut md = String::new();

    // Header
    md.push_str(&format!("# {}\n\n", conversation.title.replace('\n', " ")));
    md.push_str(&format!("**Model:** {}\n\n", conversation.model));
    md.push_str(&format!(
        "**Created:** {}\n\n",
        chrono::DateTime::from_timestamp(conversation.created_at, 0)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| conversation.created_at.to_string())
    ));

    // Messages
    md.push_str("---\n\n");

    for msg in &conversation.messages {
        let role_label = if msg.role.eq_ignore_ascii_case("user") {
            "User"
        } else {
            "Assistant"
        };

        md.push_str(&format!("## {}\n\n", role_label));

        // Include model name if present (for assistant messages)
        if let Some(ref model) = msg.model {
            md.push_str(&format!("*Model: {}*\n\n", model));
        }

        // Content
        md.push_str(&format!("{}\n\n", msg.content));

        // RAG sources if present
        if let Some(sources) = &msg.rag_sources {
            if !sources.is_empty() {
                md.push_str("**Sources:**\n\n");
                for source in sources {
                    md.push_str(&format!(
                        "- `{}:{}`\n",
                        source.file_path,
                        format_line_range(source.start_line, source.end_line)
                    ));
                }
                md.push('\n');
            }
        }

        md.push_str("---\n\n");
    }

    md
}

/// Exports a conversation to Markdown format.
///
/// Fetches the conversation from the store, formats it as Markdown, and writes
/// the result to `path`. Re-exports `error_codes::CONVERSATION_NOT_FOUND` on
/// store errors and `error_codes::FILE_SYSTEM_ERROR` on write failures.
///
/// This is the service-level entry point used by the
/// `cmd_export_markdown` command adapter in `conversation::commands`.
pub(crate) async fn export_markdown(
    store: Arc<Mutex<ConversationStore>>,
    conversation_id: String,
    path: String,
) -> ApiResponse<bool> {
    // Fetch conversation with messages
    let conversation = match store
        .lock()
        .await
        .get_conversation_with_messages(&conversation_id)
        .await
    {
        Ok(conv) => conv,
        Err(e) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new(
                    error_codes::CONVERSATION_NOT_FOUND,
                    format!("Failed to fetch conversation {}: {}", conversation_id, e),
                )),
            };
        }
    };

    // Format as Markdown
    let markdown_content = format_conversation_as_markdown(&conversation);

    // Write to file
    match fs::write(Path::new(&path), markdown_content) {
        Ok(_) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::FILE_SYSTEM_ERROR,
                format!("Failed to write export file: {}", e),
            )),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation::models::{ChatSettings, Conversation, Message, RagSource};

    fn create_test_conversation() -> Conversation {
        Conversation {
            id: "test-conv-123".to_string(),
            title: "Test Conversation".to_string(),
            model: "llama3:8b".to_string(),
            settings: ChatSettings::default(),
            created_at: 1700000000,
            updated_at: 1700000000,
            messages: vec![
                Message {
                    id: "msg-1".to_string(),
                    role: "user".to_string(),
                    content: "Hello, how are you?".to_string(),
                    images: None,
                    timestamp: 1700000001,
                    model: None,
                    done: None,
                    request_id: None,
                    eval_count: None,
                    total_duration: None,
                    eval_duration: None,
                    rag_sources: None,
                },
                Message {
                    id: "msg-2".to_string(),
                    role: "assistant".to_string(),
                    content: "I'm doing great, thank you!".to_string(),
                    images: None,
                    timestamp: 1700000002,
                    model: Some("llama3:8b".to_string()),
                    done: Some(true),
                    request_id: Some("req-123".to_string()),
                    eval_count: Some(50),
                    total_duration: Some(1000),
                    eval_duration: Some(500),
                    rag_sources: Some(vec![RagSource {
                        file_path: "/path/to/file.rs".to_string(),
                        start_line: 10,
                        end_line: 25,
                        language: Some("rust".to_string()),
                    }]),
                },
            ],
        }
    }

    #[test]
    fn test_format_line_range_single() {
        assert_eq!(format_line_range(10, 10), "l10");
        assert_eq!(format_line_range(1, 1), "l1");
    }

    #[test]
    fn test_format_line_range_multiple() {
        assert_eq!(format_line_range(10, 25), "l10-l25");
        assert_eq!(format_line_range(1, 100), "l1-l100");
    }

    #[test]
    fn test_format_conversation_as_markdown_basic() {
        let conv = create_test_conversation();
        let md = format_conversation_as_markdown(&conv);

        // Check header
        assert!(md.contains("# Test Conversation"));
        assert!(md.contains("**Model:** llama3:8b"));
        assert!(md.contains("**Created:**"));

        // Check messages
        assert!(md.contains("## User"));
        assert!(md.contains("Hello, how are you?"));
        assert!(md.contains("## Assistant"));
        assert!(md.contains("I'm doing great, thank you!"));

        // Check model info
        assert!(md.contains("*Model: llama3:8b*"));

        // Check RAG sources
        assert!(md.contains("**Sources:**"));
        assert!(md.contains("/path/to/file.rs:l10-l25"));
    }

    #[test]
    fn test_format_conversation_markdown_structure() {
        let conv = create_test_conversation();
        let md = format_conversation_as_markdown(&conv);

        // Check separators
        let separator_count = md.matches("---").count();
        assert_eq!(separator_count, 3); // One header separator, one after each message
    }

    #[test]
    fn test_format_conversation_empty_messages() {
        let mut conv = create_test_conversation();
        conv.messages = vec![];
        let md = format_conversation_as_markdown(&conv);

        assert!(md.contains("# Test Conversation"));
        assert!(!md.contains("## User"));
        assert!(!md.contains("## Assistant"));
    }

    #[test]
    fn test_format_conversation_multiple_messages() {
        let mut conv = create_test_conversation();
        conv.messages.push(Message {
            id: "msg-3".to_string(),
            role: "user".to_string(),
            content: "Can you help me with Rust?".to_string(),
            images: None,
            timestamp: 1700000003,
            model: None,
            done: None,
            request_id: None,
            eval_count: None,
            total_duration: None,
            eval_duration: None,
            rag_sources: None,
        });

        let md = format_conversation_as_markdown(&conv);
        let user_count = md.matches("## User").count();
        assert_eq!(user_count, 2);
    }

    #[test]
    fn test_format_conversation_rag_sources_empty() {
        let mut conv = create_test_conversation();
        conv.messages[1].rag_sources = None;
        let md = format_conversation_as_markdown(&conv);

        assert!(!md.contains("**Sources:**"));
    }

    #[test]
    fn test_format_conversation_rag_sources_multiple() {
        let mut conv = create_test_conversation();
        conv.messages[1].rag_sources = Some(vec![
            RagSource {
                file_path: "/path/to/file1.rs".to_string(),
                start_line: 10,
                end_line: 25,
                language: Some("rust".to_string()),
            },
            RagSource {
                file_path: "/path/to/file2.rs".to_string(),
                start_line: 50,
                end_line: 50,
                language: Some("rust".to_string()),
            },
        ]);

        let md = format_conversation_as_markdown(&conv);
        assert!(md.contains("/path/to/file1.rs:l10-l25"));
        assert!(md.contains("/path/to/file2.rs:l50"));
    }

    #[test]
    fn test_user_role_normalization() {
        let mut conv = create_test_conversation();
        conv.messages[0].role = "USER".to_string();
        let md = format_conversation_as_markdown(&conv);

        assert!(md.contains("## User"));
    }

    #[test]
    fn test_assistant_role_normalization() {
        let mut conv = create_test_conversation();
        conv.messages[1].role = "ASSISTANT".to_string();
        let md = format_conversation_as_markdown(&conv);

        assert!(md.contains("## Assistant"));
    }

    #[test]
    fn test_title_newline_replacement() {
        let mut conv = create_test_conversation();
        conv.title = "Test\nWith\nNewlines".to_string();
        let md = format_conversation_as_markdown(&conv);

        assert!(md.contains("# Test With Newlines"));
        // Title newlines should be replaced with spaces
        assert!(!md.contains("# Test\n"));
    }
}
