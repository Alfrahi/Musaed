use std::sync::Arc;

use crate::conversation::models::{Conversation, Message};
use crate::conversation::service;
use crate::conversation::store::ConversationStore;
use crate::payloads::ApiResponse;
use tauri::State;
use tokio::sync::Mutex;

#[tauri::command]
pub async fn cmd_conversations_list(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
) -> Result<ApiResponse<Vec<Conversation>>, tauri::Error> {
    Ok(service::list_conversations(state.inner().clone()).await)
}

#[tauri::command]
pub async fn cmd_conversation_get(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    id: String,
) -> Result<ApiResponse<Conversation>, tauri::Error> {
    Ok(service::get_conversation(state.inner().clone(), id).await)
}

#[tauri::command]
pub async fn cmd_conversation_create(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    conversation: Conversation,
) -> Result<ApiResponse<String>, tauri::Error> {
    Ok(service::create_conversation(state.inner().clone(), conversation).await)
}

#[tauri::command]
pub async fn cmd_message_append(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    conversation_id: String,
    message: Message,
) -> Result<ApiResponse<()>, tauri::Error> {
    Ok(service::append_message(state.inner().clone(), conversation_id, message).await)
}

#[tauri::command]
pub async fn cmd_conversation_delete(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    id: String,
) -> Result<ApiResponse<()>, tauri::Error> {
    Ok(service::delete_conversation(state.inner().clone(), id).await)
}

#[tauri::command]
pub async fn cmd_conversations_clear(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
) -> Result<ApiResponse<()>, tauri::Error> {
    Ok(service::clear_all_conversations(state.inner().clone()).await)
}

#[tauri::command]
pub async fn cmd_conversation_update(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    id: String,
    title: String,
    updated_at: i64,
) -> Result<ApiResponse<()>, tauri::Error> {
    Ok(service::update_conversation(state.inner().clone(), id, title, updated_at).await)
}

#[tauri::command]
pub async fn cmd_export_markdown(
    app: tauri::AppHandle,
    conversation_id: String,
    path: String,
) -> ApiResponse<bool> {
    use tauri::Manager;
    let store = app.state::<Arc<Mutex<ConversationStore>>>();
    crate::conversation::export::export_markdown(store.inner().clone(), conversation_id, path).await
}
