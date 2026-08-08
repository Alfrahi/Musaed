use crate::conversation::models::{Conversation, Message, MessageSearchResult};
use crate::conversation::store::ConversationStore;
use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing;

/// Convert BackendError into an ApiResponse error payload.
fn backend_error_to_response<T>(code: &'static str, err: impl std::fmt::Display) -> ApiResponse<T> {
    ApiResponse {
        success: false,
        data: None,
        error: Some(BackendError::new(code, err.to_string())),
    }
}

/// List all conversations.
pub async fn list_conversations(
    store: Arc<Mutex<ConversationStore>>,
) -> ApiResponse<Vec<Conversation>> {
    tracing::info!("Listing all conversations");
    let guard = store.lock().await;
    match guard.list_conversations().await {
        Ok(list) => {
            tracing::info!("Listed {} conversations", list.len());
            ApiResponse {
                success: true,
                data: Some(list),
                error: None,
            }
        }
        Err(e) => {
            tracing::error!("Failed to list conversations: {}", e);
            backend_error_to_response(error_codes::CONVERSATION_LIST_ERROR, e)
        }
    }
}

/// Get a single conversation with its messages.
pub async fn get_conversation(
    store: Arc<Mutex<ConversationStore>>,
    id: String,
) -> ApiResponse<Conversation> {
    tracing::info!("Getting conversation: {}", id);
    let guard = store.lock().await;
    match guard.get_conversation_with_messages(&id).await {
        Ok(conv) => {
            tracing::info!("Retrieved conversation: {}", id);
            ApiResponse {
                success: true,
                data: Some(conv),
                error: None,
            }
        }
        Err(e) => {
            tracing::warn!("Conversation not found: {} — {}", id, e);
            backend_error_to_response(error_codes::CONVERSATION_NOT_FOUND, e)
        }
    }
}

/// Create a new conversation.
pub async fn create_conversation(
    store: Arc<Mutex<ConversationStore>>,
    conv: Conversation,
) -> ApiResponse<String> {
    tracing::info!("Creating conversation: {}", conv.id);
    let guard = store.lock().await;
    match guard.create_conversation(&conv).await {
        Ok(_) => {
            tracing::info!("Created conversation: {}", conv.id);
            ApiResponse {
                success: true,
                data: Some(conv.id.clone()),
                error: None,
            }
        }
        Err(e) => {
            tracing::error!("Failed to create conversation {}: {}", conv.id, e);
            backend_error_to_response(error_codes::CONVERSATION_CREATE_ERROR, e)
        }
    }
}

/// Append a message to an existing conversation.
pub async fn append_message(
    store: Arc<Mutex<ConversationStore>>,
    conversation_id: String,
    message: Message,
) -> ApiResponse<()> {
    tracing::info!(
        "Appending message to conversation {}: role={}",
        conversation_id,
        message.role
    );
    let guard = store.lock().await;
    match guard.add_message(&conversation_id, &message).await {
        Ok(_) => {
            tracing::info!("Appended message to conversation: {}", conversation_id);
            ApiResponse {
                success: true,
                data: Some(()),
                error: None,
            }
        }
        Err(e) => {
            tracing::error!(
                "Failed to append message to conversation {}: {}",
                conversation_id,
                e
            );
            backend_error_to_response(error_codes::MESSAGE_APPEND_ERROR, e)
        }
    }
}

/// Delete a conversation.
pub async fn delete_conversation(
    store: Arc<Mutex<ConversationStore>>,
    id: String,
) -> ApiResponse<()> {
    tracing::info!("Deleting conversation: {}", id);
    let guard = store.lock().await;
    match guard.delete_conversation(&id).await {
        Ok(_) => {
            tracing::info!("Deleted conversation: {}", id);
            ApiResponse {
                success: true,
                data: Some(()),
                error: None,
            }
        }
        Err(e) => {
            tracing::error!("Failed to delete conversation {}: {}", id, e);
            backend_error_to_response(error_codes::CONVERSATION_DELETE_ERROR, e)
        }
    }
}

/// Delete a single message from a conversation.
pub async fn delete_message(
    store: Arc<Mutex<ConversationStore>>,
    conversation_id: String,
    message_id: String,
) -> ApiResponse<()> {
    tracing::info!(
        "Deleting message {} from conversation {}",
        message_id,
        conversation_id
    );
    let guard = store.lock().await;
    match guard.delete_message(&conversation_id, &message_id).await {
        Ok(_) => {
            tracing::info!(
                "Deleted message {} from conversation {}",
                message_id,
                conversation_id
            );
            ApiResponse {
                success: true,
                data: Some(()),
                error: None,
            }
        }
        Err(e) => {
            tracing::error!(
                "Failed to delete message {} from conversation {}: {}",
                message_id,
                conversation_id,
                e
            );
            backend_error_to_response(error_codes::MESSAGE_DELETE_ERROR, e)
        }
    }
}

/// Clear all conversations.
pub async fn clear_all_conversations(store: Arc<Mutex<ConversationStore>>) -> ApiResponse<()> {
    tracing::info!("Clearing all conversations");
    let guard = store.lock().await;
    match guard.clear_all_conversations().await {
        Ok(_) => {
            tracing::info!("Cleared all conversations");
            ApiResponse {
                success: true,
                data: Some(()),
                error: None,
            }
        }
        Err(e) => {
            tracing::error!("Failed to clear all conversations: {}", e);
            backend_error_to_response(error_codes::CONVERSATION_DELETE_ERROR, e)
        }
    }
}

/// Update a conversation's metadata.
pub async fn update_conversation(
    store: Arc<Mutex<ConversationStore>>,
    id: String,
    title: String,
    updated_at: i64,
) -> ApiResponse<()> {
    tracing::info!("Updating conversation {}: title={}", id, title);
    let guard = store.lock().await;
    match guard.update_conversation(&id, &title, updated_at).await {
        Ok(_) => {
            tracing::info!("Updated conversation: {}", id);
            ApiResponse {
                success: true,
                data: Some(()),
                error: None,
            }
        }
        Err(e) => {
            tracing::error!("Failed to update conversation {}: {}", id, e);
            backend_error_to_response(error_codes::CONVERSATION_UPDATE_ERROR, e)
        }
    }
}

/// Search messages across all conversations.
pub async fn search_messages(
    store: Arc<Mutex<ConversationStore>>,
    query: String,
    limit: usize,
) -> ApiResponse<Vec<MessageSearchResult>> {
    tracing::info!("Searching messages: query={}, limit={}", query, limit);
    let guard = store.lock().await;
    match guard.search_messages(&query, limit).await {
        Ok(results) => {
            tracing::info!("Message search returned {} results", results.len());
            ApiResponse {
                success: true,
                data: Some(results),
                error: None,
            }
        }
        Err(e) => {
            tracing::error!("Message search failed: {}", e);
            backend_error_to_response(error_codes::CONVERSATION_SEARCH_ERROR, e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation::models::{ChatSettings, Conversation, Message};
    use std::sync::Arc;
    use tempfile::tempdir;
    use tokio::sync::Mutex;

    /// Build a service-ready `Arc<Mutex<ConversationStore>>` backed by a
    /// temp-directory SQLite DB, then seed it with one conversation + message.
    async fn make_store_with_message(
        conv_id: &str,
        conv_title: &str,
        msg_id: &str,
        role: &str,
        content: &str,
    ) -> Arc<Mutex<ConversationStore>> {
        let dir = tempdir().unwrap();
        let store = ConversationStore::new(&dir.path().join("test.sqlite3")).unwrap();
        let ts = 1000i64;
        let conv = Conversation {
            id: conv_id.to_string(),
            title: conv_title.to_string(),
            model: "test-model".to_string(),
            settings: ChatSettings::default(),
            created_at: ts,
            updated_at: ts,
            messages: vec![],
        };
        store.create_conversation(&conv).await.unwrap();
        let msg = Message {
            id: msg_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            images: None,
            timestamp: ts,
            model: None,
            done: None,
            request_id: None,
            eval_count: None,
            prompt_eval_count: None,
            total_duration: None,
            eval_duration: None,
            rag_sources: None,
            error: None,
        };
        store.add_message(conv_id, &msg).await.unwrap();
        Arc::new(Mutex::new(store))
    }

    #[tokio::test]
    async fn test_service_search_returns_success_with_results() {
        let store = make_store_with_message(
            "conv-1",
            "Test Chat",
            "msg-1",
            "user",
            "Tell me about Rust programming.",
        )
        .await;

        let resp = search_messages(store, "Rust".to_string(), 50).await;
        assert!(resp.success);
        let results = resp.data.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].message.id, "msg-1");
        assert_eq!(results[0].conversation_id, "conv-1");
        assert_eq!(results[0].conversation_title, "Test Chat");
    }

    #[tokio::test]
    async fn test_service_search_returns_empty_success_when_no_match() {
        let store =
            make_store_with_message("conv-1", "Test Chat", "msg-1", "user", "Hello world").await;

        let resp = search_messages(store, "nonexistent".to_string(), 50).await;
        assert!(resp.success);
        assert!(resp.data.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_service_delete_message_removes_message() {
        let store =
            make_store_with_message("conv-1", "Test Chat", "msg-1", "user", "Hello world").await;

        let resp = delete_message(store, "conv-1".to_string(), "msg-1".to_string()).await;
        assert!(resp.success);
    }

    #[tokio::test]
    async fn test_service_delete_message_succeeds_even_if_not_found() {
        let store =
            make_store_with_message("conv-1", "Test Chat", "msg-1", "user", "Hello world").await;

        let resp = delete_message(store, "conv-1".to_string(), "nonexistent".to_string()).await;
        assert!(resp.success);
    }
}
