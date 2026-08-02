use crate::conversation::models::{Conversation, Message};
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
