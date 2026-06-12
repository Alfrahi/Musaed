use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Conversation data structures that match the TypeScript contracts
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub model: String,
    pub settings: ChatSettings,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    pub messages: Vec<Message>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatSettings {
    pub temperature: f64,
    #[serde(rename = "top_k")]
    pub top_k: i32,
    #[serde(rename = "top_p")]
    pub top_p: f64,
    #[serde(rename = "num_predict")]
    pub num_predict: i32,
    #[serde(rename = "num_ctx")]
    pub num_ctx: i32,
    pub stop: Vec<String>,
    #[serde(rename = "systemPrompt")]
    pub system_prompt: String,
    #[serde(rename = "ollamaUrl")]
    pub ollama_url: String,
    pub language: String,
    pub theme: String,
    #[serde(rename = "hasDetectedLanguage")]
    pub has_detected_language: bool,
    #[serde(rename = "enterToSend")]
    pub enter_to_send: bool,
    #[serde(rename = "chatRetentionDays")]
    pub chat_retention_days: i32,
    #[serde(rename = "enableLatex")]
    pub enable_latex: bool,
    #[serde(rename = "enableMermaid")]
    pub enable_mermaid: bool,
    pub density: f64,
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
        }
    }
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
