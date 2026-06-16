use std::sync::Arc;

use crate::conversation::models::{Conversation, Message};
use crate::conversation::store::ConversationStore;
use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use tauri::State;
use tokio::sync::Mutex;

/// Converts an ApiResponse into a Result that Tauri's async command system expects.
/// This satisfies the AsyncCommandMustReturnResult trait bound while preserving
/// the structured error format expected by the frontend.
fn to_tauri_result<T>(response: ApiResponse<T>) -> Result<ApiResponse<T>, tauri::Error> {
    Ok(response)
}

#[tauri::command]
pub async fn cmd_conversations_list(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
) -> Result<ApiResponse<Vec<Conversation>>, tauri::Error> {
    let store = state.inner().lock().await;
    match store.list_conversations().await {
        Ok(conversations) => to_tauri_result(ApiResponse {
            success: true,
            data: Some(conversations),
            error: None,
        }),
        Err(e) => to_tauri_result(ApiResponse {
            success: false,
            data: None,
            error: Some(
                BackendError::new(error_codes::CONVERSATION_LIST_ERROR, e.to_string()).retryable(),
            ),
        }),
    }
}

#[tauri::command]
pub async fn cmd_conversation_get(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    id: String,
) -> Result<ApiResponse<Conversation>, tauri::Error> {
    let store = state.inner().lock().await;
    match store.get_conversation_with_messages(&id).await {
        Ok(conversation) => to_tauri_result(ApiResponse {
            success: true,
            data: Some(conversation),
            error: None,
        }),
        Err(e) => to_tauri_result(ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::CONVERSATION_NOT_FOUND,
                e.to_string(),
            )),
        }),
    }
}

#[tauri::command]
pub async fn cmd_conversation_create(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    conversation: Conversation,
) -> Result<ApiResponse<String>, tauri::Error> {
    let store = state.inner().lock().await;
    match store.create_conversation(&conversation).await {
        Ok(_) => to_tauri_result(ApiResponse {
            success: true,
            data: Some(conversation.id.clone()),
            error: None,
        }),
        Err(e) => to_tauri_result(ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::CONVERSATION_CREATE_ERROR,
                e.to_string(),
            )),
        }),
    }
}

#[tauri::command]
pub async fn cmd_message_append(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    conversation_id: String,
    message: Message,
) -> Result<ApiResponse<()>, tauri::Error> {
    let store = state.inner().lock().await;
    match store.add_message(&conversation_id, &message).await {
        Ok(_) => to_tauri_result(ApiResponse {
            success: true,
            data: Some(()),
            error: None,
        }),
        Err(e) => to_tauri_result(ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::MESSAGE_APPEND_ERROR,
                e.to_string(),
            )),
        }),
    }
}

#[tauri::command]
pub async fn cmd_conversation_delete(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    id: String,
) -> Result<ApiResponse<()>, tauri::Error> {
    let store = state.inner().lock().await;
    match store.delete_conversation(&id).await {
        Ok(_) => to_tauri_result(ApiResponse {
            success: true,
            data: Some(()),
            error: None,
        }),
        Err(e) => to_tauri_result(ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::CONVERSATION_DELETE_ERROR,
                e.to_string(),
            )),
        }),
    }
}

#[tauri::command]
pub async fn cmd_conversations_clear(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
) -> Result<ApiResponse<()>, tauri::Error> {
    let store = state.inner().lock().await;
    match store.clear_all_conversations().await {
        Ok(_) => to_tauri_result(ApiResponse {
            success: true,
            data: Some(()),
            error: None,
        }),
        Err(e) => to_tauri_result(ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::CONVERSATION_DELETE_ERROR,
                e.to_string(),
            )),
        }),
    }
}

#[tauri::command]
pub async fn cmd_conversation_update(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    id: String,
    title: String,
    updated_at: i64,
) -> Result<ApiResponse<()>, tauri::Error> {
    let store = state.inner().lock().await;
    match store.update_conversation(&id, &title, updated_at).await {
        Ok(_) => to_tauri_result(ApiResponse {
            success: true,
            data: Some(()),
            error: None,
        }),
        Err(e) => to_tauri_result(ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::CONVERSATION_UPDATE_ERROR,
                e.to_string(),
            )),
        }),
    }
}
