use std::sync::Arc;

use crate::conversation::models::{Conversation, Message, MessageSearchResult};
use crate::conversation::service;
use crate::conversation::store::ConversationStore;
use crate::conversation::validation::{self, reject};
use crate::conversation::write_batch;
use crate::payloads::ApiResponse;
use tauri::State;
use tokio::sync::Mutex;

#[tauri::command]
pub async fn cmd_conversations_list(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
) -> Result<ApiResponse<Vec<Conversation>>, String> {
    Ok(service::list_conversations(state.inner().clone()).await)
}

#[tauri::command]
pub async fn cmd_conversation_get(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    id: String,
) -> Result<ApiResponse<Conversation>, String> {
    if let Err(msg) = validation::validate_conversation_id(&id) {
        return Ok(reject("cmd_conversation_get", msg));
    }
    Ok(service::get_conversation(state.inner().clone(), id).await)
}

#[tauri::command]
pub async fn cmd_conversation_create(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    conversation: Conversation,
) -> Result<ApiResponse<String>, String> {
    if let Err(msg) = validation::validate_conversation(&conversation) {
        return Ok(reject("cmd_conversation_create", msg));
    }
    Ok(service::create_conversation(state.inner().clone(), conversation).await)
}

#[tauri::command]
pub async fn cmd_message_append(
    state: State<'_, write_batch::WriteBatcher>,
    conversation_id: String,
    message: Message,
) -> Result<ApiResponse<()>, String> {
    if let Err(msg) = validation::validate_conversation_id(&conversation_id) {
        return Ok(reject("cmd_message_append", msg));
    }
    if let Err(msg) = validation::validate_message(&message) {
        return Ok(reject("cmd_message_append", msg));
    }
    Ok(service::append_message(state.inner().clone(), conversation_id, message).await)
}

#[tauri::command]
pub async fn cmd_conversation_delete(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    id: String,
) -> Result<ApiResponse<()>, String> {
    if let Err(msg) = validation::validate_conversation_id(&id) {
        return Ok(reject("cmd_conversation_delete", msg));
    }
    Ok(service::delete_conversation(state.inner().clone(), id).await)
}

#[tauri::command]
pub async fn cmd_message_delete(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    conversation_id: String,
    message_id: String,
) -> Result<ApiResponse<()>, String> {
    if let Err(msg) = validation::validate_conversation_id(&conversation_id) {
        return Ok(reject("cmd_message_delete", msg));
    }
    if let Err(msg) = validation::validate_message_id(&message_id) {
        return Ok(reject("cmd_message_delete", msg));
    }
    Ok(service::delete_message(state.inner().clone(), conversation_id, message_id).await)
}

#[tauri::command]
pub async fn cmd_conversations_clear(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
) -> Result<ApiResponse<()>, String> {
    Ok(service::clear_all_conversations(state.inner().clone()).await)
}

#[tauri::command]
pub async fn cmd_conversation_update(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    id: String,
    title: String,
    updated_at: i64,
) -> Result<ApiResponse<()>, String> {
    if let Err(msg) = validation::validate_conversation_id(&id) {
        return Ok(reject("cmd_conversation_update", msg));
    }
    if let Err(msg) = validation::validate_title(&title) {
        return Ok(reject("cmd_conversation_update", msg));
    }
    if let Err(msg) = validation::validate_timestamp(updated_at, "updatedAt") {
        return Ok(reject("cmd_conversation_update", msg));
    }
    Ok(service::update_conversation(state.inner().clone(), id, title, updated_at).await)
}

#[tauri::command]
pub async fn cmd_conversation_search(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    query: String,
    limit: usize,
) -> Result<ApiResponse<Vec<MessageSearchResult>>, String> {
    if let Err(msg) = validation::validate_search(&query, limit) {
        return Ok(reject("cmd_conversation_search", msg));
    }
    Ok(service::search_messages(state.inner().clone(), query, limit).await)
}
