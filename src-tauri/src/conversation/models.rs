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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
    pub timestamp: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
    #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(rename = "evalCount", skip_serializing_if = "Option::is_none")]
    pub eval_count: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_duration: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eval_duration: Option<i64>,
    #[serde(rename = "ragSources", skip_serializing_if = "Option::is_none")]
    pub rag_sources: Option<Vec<RagSource>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RagSource {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "startLine")]
    pub start_line: u32,
    #[serde(rename = "endLine")]
    pub end_line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

/// Initialize the conversation store - creates necessary directories and database
pub fn init_conversation_store(_app_handle: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Implementation would go here
    Ok(())
}
