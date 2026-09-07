use crate::conversation::models::{Conversation, Message, MessageSearchResult};
use crate::conversation::store::ConversationStore;
use crate::conversation::write_batch::WriteBatcher;
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

/// All ConversationStore methods are now synchronous over a
/// `std::sync::Mutex<Connection>`; run them on the blocking pool so the
/// Tokio runtime is never stalled by SQLite I/O.
async fn db_call<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> rusqlite::Result<T> + Send + 'static,
{
    match tokio::task::spawn_blocking(f).await {
        Ok(r) => r.map_err(|e| e.to_string()),
        Err(e) => Err(format!("blocking task join error: {}", e)),
    }
}

/// List all conversations.
pub async fn list_conversations(
    store: Arc<Mutex<ConversationStore>>,
) -> ApiResponse<Vec<Conversation>> {
    tracing::info!("Listing all conversations");
    match db_call(move || {
        let guard = store.blocking_lock();
        guard.list_conversations()
    })
    .await
    {
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
    let id2 = id.clone();
    match db_call(move || {
        let guard = store.blocking_lock();
        guard.get_conversation_with_messages(&id2)
    })
    .await
    {
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
    let conv_id = conv.id.clone();
    match db_call(move || {
        let guard = store.blocking_lock();
        guard.create_conversation(&conv)
    })
    .await
    {
        Ok(_) => {
            tracing::info!("Created conversation: {}", conv_id);
            ApiResponse {
                success: true,
                data: Some(conv_id.clone()),
                error: None,
            }
        }
        Err(e) => {
            tracing::error!("Failed to create conversation {}: {}", conv_id, e);
            backend_error_to_response(error_codes::CONVERSATION_CREATE_ERROR, e)
        }
    }
}

/// Append a message to an existing conversation.
///
/// The write goes through the batch writer: this call still resolves only
/// after the message is durably committed, but under load multiple appends
/// share one transaction and one lock acquisition.
pub async fn append_message(
    batcher: WriteBatcher,
    conversation_id: String,
    message: Message,
) -> ApiResponse<()> {
    tracing::info!(
        "Appending message to conversation {}: role={}",
        conversation_id,
        message.role
    );
    match batcher.append(conversation_id.clone(), message).await {
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
    let id2 = id.clone();
    match db_call(move || {
        let guard = store.blocking_lock();
        guard.delete_conversation(&id2)
    })
    .await
    {
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
    let cid = conversation_id.clone();
    let mid = message_id.clone();
    match tokio::task::spawn_blocking(move || {
        let guard = store.blocking_lock();
        guard.delete_message(&cid, &mid).map_err(|e| e.to_string())
    })
    .await
    {
        Ok(Ok(_)) => {
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
        Ok(Err(e)) => {
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
    match db_call(move || {
        let guard = store.blocking_lock();
        guard.clear_all_conversations()
    })
    .await
    {
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

/// Update a conversation's metadata. `updated_at` is stamped from the server
/// clock — client-supplied timestamps are not trusted (see
/// `cmd_conversation_update`).
pub async fn update_conversation(
    store: Arc<Mutex<ConversationStore>>,
    id: String,
    title: String,
) -> ApiResponse<()> {
    tracing::info!("Updating conversation {}: title={}", id, title);
    let updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default();
    let id2 = id.clone();
    match db_call(move || {
        let guard = store.blocking_lock();
        guard.update_conversation(&id2, &title, updated_at)
    })
    .await
    {
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
    match db_call(move || {
        let guard = store.blocking_lock();
        guard.search_messages(&query, limit)
    })
    .await
    {
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
        store.create_conversation(&conv).unwrap();
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
            completion_tokens: None,
            prompt_eval_count: None,
            prompt_tokens: None,
            total_tokens: None,
            total_duration: None,
            eval_duration: None,
            rag_sources: None,
            error: None,
        };
        store.add_message(conv_id, &msg).unwrap();
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

    /// MEDIUM-3: `updated_at` must be stamped from the server clock, not the
    /// client-supplied epoch (client can no longer pin a conversation to the
    /// top of the list with a far-future timestamp).
    #[tokio::test]
    async fn test_update_conversation_stamps_server_time() {
        let store =
            make_store_with_message("conv-1", "Old Title", "msg-1", "user", "Hello world").await;
        let seeded_ts = 1000i64;

        let before_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let resp =
            update_conversation(store.clone(), "conv-1".to_string(), "New Title".to_string()).await;
        assert!(resp.success);
        let after_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        let conv = {
            let guard = store.lock().await;
            guard.get_conversation("conv-1").unwrap()
        };
        assert_eq!(conv.title, "New Title");
        assert!(
            conv.updated_at != seeded_ts,
            "updated_at must be re-stamped, got seed value"
        );
        assert!(
            conv.updated_at >= before_ms && conv.updated_at <= after_ms,
            "updated_at {} not within server-observed window [{}, {}]",
            conv.updated_at,
            before_ms,
            after_ms
        );
    }
}
