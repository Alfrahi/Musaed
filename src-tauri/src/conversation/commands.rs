use std::sync::{Arc, Mutex};

use crate::conversation::models::{Conversation, Message};
use crate::conversation::store::ConversationStore;
use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use tauri::State;

/// Builds a lock-failure `ApiResponse` for conversation Mutex errors.
/// This replaces the previous `Err(e.to_string())` path, which sent a raw
/// `String` across the IPC boundary — incompatible with the TS
/// `BackendErrorSchema` that expects a structured `{ code, message,
/// requestId, context, isRetryable }` object.
fn lock_error<T>(e: impl std::fmt::Display) -> ApiResponse<T> {
    ApiResponse {
        success: false,
        data: None,
        error: Some(
            BackendError::new(error_codes::CONVERSATION_LOCK_ERROR, e.to_string()).retryable(),
        ),
    }
}

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
    let store = match state.inner().lock() {
        Ok(s) => s,
        Err(e) => return to_tauri_result(lock_error(e)),
    };
    match store.list_conversations() {
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
    let store = match state.inner().lock() {
        Ok(s) => s,
        Err(e) => return to_tauri_result(lock_error(e)),
    };
    match store.get_conversation_with_messages(&id) {
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
    let store = match state.inner().lock() {
        Ok(s) => s,
        Err(e) => return to_tauri_result(lock_error(e)),
    };
    match store.create_conversation(&conversation) {
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
    let store = match state.inner().lock() {
        Ok(s) => s,
        Err(e) => return to_tauri_result(lock_error(e)),
    };
    match store.add_message(&conversation_id, &message) {
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
    let store = match state.inner().lock() {
        Ok(s) => s,
        Err(e) => return to_tauri_result(lock_error(e)),
    };
    match store.delete_conversation(&id) {
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
    let store = match state.inner().lock() {
        Ok(s) => s,
        Err(e) => return to_tauri_result(lock_error(e)),
    };
    match store.clear_all_conversations() {
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
    let store = match state.inner().lock() {
        Ok(s) => s,
        Err(e) => return to_tauri_result(lock_error(e)),
    };
    match store.update_conversation(&id, &title, updated_at) {
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
