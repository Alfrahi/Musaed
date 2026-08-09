use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;

/// Structured error payload attached to a `Message` when streaming or
/// persistence fails. Mirrors `packages/contracts/src/schemas/conversation.ts`
/// (`message.error`) so the frontend can render the banner without falling
/// back to the legacy `[Error:` substring heuristic.
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct MessageError {
    pub code: String,
    pub message: String,
}

/// Conversation data structures that match the TypeScript contracts
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub model: String,
    pub settings: ChatSettings,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages: Vec<Message>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatSettings {
    pub temperature: f64,
    pub top_k: i32,
    pub top_p: f64,
    pub num_predict: i32,
    pub num_ctx: i32,
    pub stop: Vec<String>,
    pub system_prompt: String,
    pub ollama_url: String,
    pub language: String,
    pub theme: String,
    pub has_detected_language: bool,
    pub enter_to_send: bool,
    pub chat_retention_days: i32,
    pub enable_latex: bool,
    pub enable_mermaid: bool,
    pub density: f64,
    pub sidebar_width: u32,
    pub sidebar_collapsed: bool,
    pub show_token_indicator: bool,
    pub close_to_tray: bool,
}

impl Default for ChatSettings {
    fn default() -> Self {
        Self {
            temperature: 0.7,
            top_k: 40,
            top_p: 0.9,
            num_predict: 2048,
            num_ctx: 4096,
            stop: Vec::new(),
            system_prompt: String::new(),
            ollama_url: "http://localhost:11434".to_string(),
            language: "en".to_string(),
            theme: "system".to_string(),
            has_detected_language: false,
            enter_to_send: true,
            chat_retention_days: 0,
            enable_latex: false,
            enable_mermaid: true,
            density: 1.0,
            sidebar_width: 260,
            sidebar_collapsed: false,
            show_token_indicator: true,
            close_to_tray: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eval_count: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_eval_count: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_duration: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eval_duration: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rag_sources: Option<Vec<RagSource>>,
    /// Optional structured error attached when the assistant turn failed.
    /// Round-trips with the TypeScript `Message.error` field so the frontend
    /// can render a stable banner.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<MessageError>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct RagSource {
    pub file_path: String,
    pub start_line: u32,
    pub end_line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

/// A message matched by a full-text search, bundled with its parent
/// conversation metadata so the frontend can group results by conversation.
#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct MessageSearchResult {
    pub message: Message,
    pub conversation_id: String,
    pub conversation_title: String,
}

/// Initialize the conversation store - creates necessary directories and database
pub fn init_conversation_store(_app_handle: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Implementation would go here
    Ok(())
}
