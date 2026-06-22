use crate::conversation::models::{Conversation, Message};
use crate::conversation::store::ConversationStore;
use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use std::sync::Arc;
use tokio::sync::Mutex;

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
    let guard = store.lock().await;
    match guard.list_conversations().await {
        Ok(list) => ApiResponse {
            success: true,
            data: Some(list),
            error: None,
        },
        Err(e) => backend_error_to_response(error_codes::CONVERSATION_LIST_ERROR, e),
    }
}

/// Get a single conversation with its messages.
pub async fn get_conversation(
    store: Arc<Mutex<ConversationStore>>,
    id: String,
) -> ApiResponse<Conversation> {
    let guard = store.lock().await;
    match guard.get_conversation_with_messages(&id).await {
        Ok(conv) => ApiResponse {
            success: true,
            data: Some(conv),
            error: None,
        },
        Err(e) => backend_error_to_response(error_codes::CONVERSATION_NOT_FOUND, e),
    }
}

/// Create a new conversation.
pub async fn create_conversation(
    store: Arc<Mutex<ConversationStore>>,
    conv: Conversation,
) -> ApiResponse<String> {
    let guard = store.lock().await;
    match guard.create_conversation(&conv).await {
        Ok(_) => ApiResponse {
            success: true,
            data: Some(conv.id.clone()),
            error: None,
        },
        Err(e) => backend_error_to_response(error_codes::CONVERSATION_CREATE_ERROR, e),
    }
}

/// Append a message to an existing conversation.
pub async fn append_message(
    store: Arc<Mutex<ConversationStore>>,
    conversation_id: String,
    message: Message,
) -> ApiResponse<()> {
    let guard = store.lock().await;
    match guard.add_message(&conversation_id, &message).await {
        Ok(_) => ApiResponse {
            success: true,
            data: Some(()),
            error: None,
        },
        Err(e) => backend_error_to_response(error_codes::MESSAGE_APPEND_ERROR, e),
    }
}

/// Delete a conversation.
pub async fn delete_conversation(
    store: Arc<Mutex<ConversationStore>>,
    id: String,
) -> ApiResponse<()> {
    let guard = store.lock().await;
    match guard.delete_conversation(&id).await {
        Ok(_) => ApiResponse {
            success: true,
            data: Some(()),
            error: None,
        },
        Err(e) => backend_error_to_response(error_codes::CONVERSATION_DELETE_ERROR, e),
    }
}

/// Clear all conversations.
pub async fn clear_all_conversations(store: Arc<Mutex<ConversationStore>>) -> ApiResponse<()> {
    let guard = store.lock().await;
    match guard.clear_all_conversations().await {
        Ok(_) => ApiResponse {
            success: true,
            data: Some(()),
            error: None,
        },
        Err(e) => backend_error_to_response(error_codes::CONVERSATION_DELETE_ERROR, e),
    }
}

/// Update a conversation's metadata.
pub async fn update_conversation(
    store: Arc<Mutex<ConversationStore>>,
    id: String,
    title: String,
    updated_at: i64,
) -> ApiResponse<()> {
    let guard = store.lock().await;
    match guard.update_conversation(&id, &title, updated_at).await {
        Ok(_) => ApiResponse {
            success: true,
            data: Some(()),
            error: None,
        },
        Err(e) => backend_error_to_response(error_codes::CONVERSATION_UPDATE_ERROR, e),
    }
}
