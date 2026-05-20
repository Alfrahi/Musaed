use std::sync::{Arc, Mutex};

use crate::conversation::models::{Conversation, Message};
use crate::conversation::store::ConversationStore;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize)]
pub struct CommandResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ConversationListResponse {
    conversations: Vec<Conversation>,
}

#[tauri::command]
pub async fn cmd_conversations_list(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
) -> Result<CommandResponse<ConversationListResponse>, String> {
    let store = state.inner().lock().map_err(|e| e.to_string())?;
    match store.list_conversations() {
        Ok(conversations) => {
            let response = CommandResponse {
                success: true,
                data: Some(ConversationListResponse { conversations }),
                error: None,
            };
            Ok(response)
        }
        Err(e) => {
            let response: CommandResponse<Conversation> = CommandResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            };
            Err(serde_json::to_string(&response)
                .unwrap_or_else(|_| "Failed to serialize error response".to_string()))
        }
    }
}

#[tauri::command]
pub async fn cmd_conversation_get(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    id: String,
) -> Result<CommandResponse<Conversation>, String> {
    let store = state.inner().lock().map_err(|e| e.to_string())?;
    match store.get_conversation_with_messages(&id) {
        Ok(conversation) => {
            let response = CommandResponse {
                success: true,
                data: Some(conversation),
                error: None,
            };
            Ok(response)
        }
        Err(e) => {
            let response: CommandResponse<Conversation> = CommandResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            };
            Err(serde_json::to_string(&response)
                .unwrap_or_else(|_| "Failed to serialize error response".to_string()))
        }
    }
}

#[tauri::command]
pub async fn cmd_conversation_create(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    conversation: Conversation,
) -> Result<CommandResponse<String>, String> {
    let store = state.inner().lock().map_err(|e| e.to_string())?;
    match store.create_conversation(&conversation) {
        Ok(_) => {
            let response = CommandResponse {
                success: true,
                data: Some(conversation.id.clone()),
                error: None,
            };
            Ok(response)
        }
        Err(e) => {
            let response = CommandResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            };
            Ok(response)
        }
    }
}

#[tauri::command]
pub async fn cmd_message_append(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    conversation_id: String,
    message: Message,
) -> Result<CommandResponse<()>, String> {
    let store = state.inner().lock().map_err(|e| e.to_string())?;
    match store.add_message(&conversation_id, &message) {
        Ok(_) => {
            let response = CommandResponse {
                success: true,
                data: Some(()),
                error: None,
            };
            Ok(response)
        }
        Err(e) => {
            let response = CommandResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            };
            Ok(response)
        }
    }
}

#[tauri::command]
pub async fn cmd_conversation_delete(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
    id: String,
) -> Result<CommandResponse<()>, String> {
    let store = state.inner().lock().map_err(|e| e.to_string())?;
    match store.delete_conversation(&id) {
        Ok(_) => {
            let response = CommandResponse {
                success: true,
                data: Some(()),
                error: None,
            };
            Ok(response)
        }
        Err(e) => {
            let response = CommandResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            };
            Ok(response)
        }
    }
}

#[tauri::command]
pub async fn cmd_conversations_clear(
    state: State<'_, Arc<Mutex<ConversationStore>>>,
) -> Result<CommandResponse<()>, String> {
    let store = state.inner().lock().map_err(|e| e.to_string())?;
    match store.clear_all_conversations() {
        Ok(_) => {
            let response = CommandResponse {
                success: true,
                data: Some(()),
                error: None,
            };
            Ok(response)
        }
        Err(e) => {
            let response = CommandResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            };
            Ok(response)
        }
    }
}
