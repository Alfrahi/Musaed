use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatOptions {
    pub temperature: Option<f32>,
    pub top_k: Option<u32>,
    pub top_p: Option<f32>,
    pub num_predict: Option<i32>,
    pub num_ctx: Option<u32>,
    pub stop: Option<Vec<String>>,
}

/// The `options` object sent to Ollama's `/api/chat`.
///
/// Ollama matches option keys exactly against its snake_case JSON tags and
/// silently warns+skips unknown keys, so this type has NO camelCase rename:
/// field names serialize verbatim (`top_k`, `num_ctx`, ...). [`ChatOptions`]
/// remains the IPC DTO (camelCase, TypeScript-facing); convert at the wire
/// boundary via [`OllamaOptions::from`]. `None` fields are omitted entirely.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct OllamaOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_predict: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_ctx: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop: Option<Vec<String>>,
}

impl From<&ChatOptions> for OllamaOptions {
    fn from(opts: &ChatOptions) -> Self {
        Self {
            temperature: opts.temperature,
            top_k: opts.top_k,
            top_p: opts.top_p,
            num_predict: opts.num_predict,
            num_ctx: opts.num_ctx,
            stop: opts.stop.clone(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OllamaToken {
    pub model: Option<String>,
    /// Ollama sends `created_at` (snake_case); serde expects `createdAt`
    /// (camelCase). The alias accepts both so the field round-trips from
    /// Ollama's `/api/chat` NDJSON and serializes to camelCase for the
    /// TypeScript frontend.
    #[serde(alias = "created_at")]
    pub created_at: Option<String>,
    pub message: Option<ChatMessage>,
    pub done: bool,
    #[serde(alias = "total_duration")]
    pub total_duration: Option<u64>,
    #[serde(alias = "load_duration")]
    pub load_duration: Option<u64>,
    #[serde(alias = "prompt_eval_count")]
    pub prompt_eval_count: Option<u32>,
    #[serde(alias = "prompt_eval_duration")]
    pub prompt_eval_duration: Option<u64>,
    #[serde(alias = "eval_count", alias = "completion_tokens")]
    pub eval_count: Option<u32>,
    #[serde(alias = "eval_duration")]
    pub eval_duration: Option<u64>,
    #[serde(alias = "prompt_tokens")]
    pub prompt_tokens: Option<u32>,
    #[serde(alias = "total_tokens")]
    pub total_tokens: Option<u32>,
    pub request_id: String,
}
