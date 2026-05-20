use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Conversation data structures that match the TypeScript contracts
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub model: String,
    pub settings: serde_json::Value,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    pub messages: Vec<Message>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub id: String,
    pub role: String,
    pub content: String,
    pub images: Option<Vec<String>>,
    #[serde(rename = "timestamp")]
    pub timestamp: i64,
    pub model: Option<String>,
    pub done: Option<bool>,
    #[serde(rename = "requestId")]
    pub request_id: Option<String>,
    #[serde(rename = "eval_count")]
    pub eval_count: Option<i32>,
    pub total_duration: Option<i64>,
    pub eval_duration: Option<i64>,
    pub rag_sources: Option<Vec<RagSource>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RagSource {
    pub file_path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub language: Option<String>,
}

/// Initialize the conversation store - creates necessary directories and database
pub fn init_conversation_store(_app_handle: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Implementation would go here
    Ok(())
}
