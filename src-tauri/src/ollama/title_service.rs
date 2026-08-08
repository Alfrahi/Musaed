//! Domain service for conversation title generation.
//!
//! Contains the business logic previously embedded in the Tauri command:
//! - Rate-limit gate
//! - Input validation
//! - Semaphore acquisition
//! - URL construction & prompt assembly
//! - HTTP call & response parsing
//! - Thinking-block stripping (5 tag families)
//! - Reasoning detection (21 prefix patterns)
//! - Word-count enforcement with colon/dash heuristics
//!
//! The command in [`super::title`] is now a thin adapter that constructs a
//! request struct and delegates to this service, following the same pattern as
//! [`super::service::OllamaChatService`] and [`super::model_service::ModelService`].

use super::client::{
    acquire_global_permit, invalid_ollama_base, ollama_endpoint, FAST_HTTP_CLIENT,
    FAST_TIMEOUT_SECS,
};
use crate::error_codes;
use crate::generated_validation::MAX_TITLE_INPUT_LEN;
use crate::payloads::{ApiResponse, BackendError};
use crate::rate_limiter::RATE_LIMITER;
use crate::validation::{is_valid_language, is_valid_model_name, validation_error};
use serde_json::json;
use std::time::Duration;
use tracing;

/// Maximum number of words allowed in a generated title.
const MAX_TITLE_WORDS: usize = 5;

/// Prefixes that indicate the model started reasoning instead of generating a
/// title. These are common chain-of-thought sentence starters produced when a
/// model ignores the title-generation and continues the conversation.
const REASONING_STARTERS: &[&str] = &[
    "okay",
    "alright",
    "let me",
    "let's",
    "i need",
    "i think",
    "i'll",
    "first",
    "so,",
    "so i",
    "well,",
    "the user",
    "based on",
    "to answer",
    "in order",
    "sure,",
    "sure i",
    "certainly",
    "of course",
    "here's",
    "here is",
];

/// Parameters for a title generation request.
pub struct GenerateTitleRequest {
    pub window_label: String,
    pub base_url: String,
    pub model: String,
    pub user_message: String,
    pub assistant_message: String,
    pub language: String,
}

pub struct TitleService;

impl TitleService {
    /// Generates a short conversation title by sending the first user message
    /// to Ollama with `stream: false`. Uses a system instruction that instructs the
    /// model to return only a concise title.
    pub async fn generate_title(&self, req: GenerateTitleRequest) -> ApiResponse<String> {
        if let Err(e) =
            RATE_LIMITER.check_rate_limit(&req.window_label, "cmd_ollama_generate_title")
        {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(e),
            };
        }
        tracing::info!("Generating title with model: {}", req.model);

        if !is_valid_model_name(&req.model) {
            return validation_error(
                "INVALID_INPUT",
                format!("Invalid model name: {:?}", req.model),
            );
        }
        if !is_valid_language(&req.language) {
            return validation_error(
                "INVALID_INPUT",
                format!(
                    "Invalid language: {:?}; expected 'en' or 'ar'",
                    req.language
                ),
            );
        }
        if req.user_message.len() > MAX_TITLE_INPUT_LEN {
            return validation_error(
                "INVALID_INPUT",
                format!(
                    "user_message exceeds {} bytes (got {})",
                    MAX_TITLE_INPUT_LEN,
                    req.user_message.len()
                ),
            );
        }
        if req.assistant_message.len() > MAX_TITLE_INPUT_LEN {
            return validation_error(
                "INVALID_INPUT",
                format!(
                    "assistant_message exceeds {} bytes (got {})",
                    MAX_TITLE_INPUT_LEN,
                    req.assistant_message.len()
                ),
            );
        }

        let _global_permit = match acquire_global_permit().await {
            Ok(p) => p,
            Err(msg) => {
                return ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new(error_codes::RATE_LIMITED, msg)),
                }
            }
        };

        let url = match ollama_endpoint(&req.base_url, "api/chat") {
            Ok(u) => u,
            Err(msg) => return invalid_ollama_base(msg),
        };

        let lang_instruction = if req.language == "ar" {
            "Respond in Arabic only."
        } else {
            "Respond in English only."
        };

        let system_instruction = format!(
            "You are a title generator. Given a question and answer below, produce a very short \
             descriptive title (5 words max). The title must be a label, not a sentence. \
             Examples: \"Python Loops\", \"Pasta Carbonara Recipe\", \"Climate Change Effects\". \
             Output ONLY the title. No quotes, no punctuation, no explanation. \
             {}",
            lang_instruction
        );

        let truncated_user: String = req.user_message.chars().take(500).collect();
        let truncated_assistant: String = req.assistant_message.chars().take(500).collect();

        let user_content = format!(
            "Question: {}\nAnswer: {}",
            truncated_user, truncated_assistant
        );

        let payload = json!({
            "model": req.model,
            "messages": [
                { "role": "system", "content": system_instruction },
                { "role": "user", "content": user_content }
            ],
            "stream": false,
            "options": {
                "temperature": 0.3,
                "num_predict": 30
            }
        });

        match FAST_HTTP_CLIENT
            .post(&url)
            .json(&payload)
            .timeout(Duration::from_secs(FAST_TIMEOUT_SECS))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<serde_json::Value>().await {
                    Ok(json) => {
                        let raw = json
                            .get("message")
                            .and_then(|m| m.get("content"))
                            .and_then(|c| c.as_str())
                            .unwrap_or("");

                        let title = strip_think_blocks(raw);
                        let stripped = title.trim();

                        if stripped.is_empty() {
                            return ApiResponse {
                                success: false,
                                data: None,
                                error: Some(BackendError::new(
                                    error_codes::EMPTY_TITLE,
                                    "Model returned empty title after stripping thinking blocks",
                                )),
                            };
                        }

                        if looks_like_reasoning(stripped) {
                            tracing::warn!(
                                "Title output looks like reasoning, rejecting: {:?}",
                                stripped
                            );
                            return ApiResponse {
                                success: false,
                                data: None,
                                error: Some(BackendError::new(
                                    error_codes::REASONING_INSTEAD_OF_TITLE,
                                    "Model produced reasoning instead of a title",
                                )),
                            };
                        }

                        let final_title = truncate_title_words(stripped, MAX_TITLE_WORDS);

                        tracing::info!("Generated title: {}", final_title);
                        ApiResponse {
                            success: true,
                            data: Some(final_title),
                            error: None,
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to parse title response: {}", e);
                        ApiResponse {
                            success: false,
                            data: None,
                            error: Some(BackendError::new(error_codes::PARSE_ERROR, e.to_string())),
                        }
                    }
                }
            }
            Ok(resp) => {
                let status = resp.status().as_u16();
                let body = resp.text().await.unwrap_or_default();
                tracing::error!("Title generation failed with HTTP {}: {}", status, body);
                ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new(
                        error_codes::OLLAMA_ERROR,
                        format!(
                            "HTTP {}: {}",
                            status,
                            body.chars().take(200).collect::<String>()
                        ),
                    )),
                }
            }
            Err(e) => {
                tracing::error!("Title generation request failed: {}", e);
                ApiResponse {
                    success: false,
                    data: None,
                    error: Some(
                        BackendError::new(error_codes::NETWORK_ERROR, e.to_string())
                            .with_context("Failed to generate title".to_string())
                            .retryable(),
                    ),
                }
            }
        }
    }
}

/// Returns `true` if `text` looks like a reasoning/sentence output rather than
/// a concise title label. Checked case-insensitively against known starters.
fn looks_like_reasoning(text: &str) -> bool {
    let lower = text.to_lowercase();
    REASONING_STARTERS
        .iter()
        .any(|starter| lower.starts_with(starter))
}

/// Enforces the word-count limit on a generated title.
///
/// When a model ignores the instruction and produces a sentence instead of a label,
/// blindly taking the first N words yields poor results (e.g. "ChatGPT: Large
/// Language Model from"). Instead, we look for natural separators (colon, dash)
/// and prefer the concise portion before the separator.
fn truncate_title_words(title: &str, max_words: usize) -> String {
    if let Some(colon_pos) = title.find(':') {
        let before = title[..colon_pos].trim();
        let before_words: Vec<&str> = before.split_whitespace().collect();
        if !before_words.is_empty() && before_words.len() <= max_words {
            return before.to_string();
        }
    }

    if let Some(dash_pos) = title.find(" - ") {
        let before = title[..dash_pos].trim();
        let before_words: Vec<&str> = before.split_whitespace().collect();
        if !before_words.is_empty() && before_words.len() <= max_words {
            return before.to_string();
        }
    }

    let words: Vec<&str> = title.split_whitespace().collect();
    if words.len() <= max_words {
        return title.to_string();
    }

    words[..max_words].join(" ")
}

/// Strips common thinking/reasoning blocks from model output.
///
/// Handles `<redacted-thinking>`, ` thinking` (DeepSeek-R1), `<thoughts>`,
/// `<reasoning>`, `<initial_thoughts>`, plus `<lemma>` blocks,
/// then takes the last non-empty line as the title
/// to discard any preceding chain-of-thought.
pub(crate) fn strip_think_blocks(content: &str) -> String {
    let mut result = content.to_string();

    while let Some(start) = result.find("<redacted-thinking>") {
        if let Some(end) =
            result[start + "<redacted-thinking>".len()..].find("</redacted-thinking>")
        {
            result = format!(
                "{}{}",
                &result[..start],
                &result[start + "<redacted-thinking>".len() + end + "</redacted-thinking>".len()..]
            );
        } else {
            result = result[..start].to_string();
            break;
        }
    }

    while let Some(start) = result.find(" thinking") {
        if let Some(end) = result[start + " thinking".len()..].find(" response") {
            result = format!(
                "{}{}",
                &result[..start],
                &result[start + " thinking".len() + end + " response".len()..]
            );
        } else {
            result = result[..start].to_string();
            break;
        }
    }

    while let Some(start) = result.find("<thoughts>") {
        if let Some(end) = result[start + "<thoughts>".len()..].find("</thoughts>") {
            result = format!(
                "{}{}",
                &result[..start],
                &result[start + "<thoughts>".len() + end + "</thoughts>".len()..]
            );
        } else {
            result = result[..start].to_string();
            break;
        }
    }

    while let Some(start) = result.find("<reasoning>") {
        if let Some(end) = result[start + "<reasoning>".len()..].find("</reasoning>") {
            result = format!(
                "{}{}",
                &result[..start],
                &result[start + "<reasoning>".len() + end + "</reasoning>".len()..]
            );
        } else {
            result = result[..start].to_string();
            break;
        }
    }

    while let Some(start) = result.find("<initial_thoughts>") {
        if let Some(end) = result[start + "<initial_thoughts>".len()..].find("</initial_thoughts>")
        {
            result = format!(
                "{}{}",
                &result[..start],
                &result[start + "<initial_thoughts>".len() + end + "</initial_thoughts>".len()..]
            );
        } else {
            result = result[..start].to_string();
            break;
        }
    }

    while let Some(start) = result.find("<lemma>") {
        if let Some(end) = result[start + "<lemma>".len()..].find("</lemma>") {
            result = format!(
                "{}{}",
                &result[..start],
                &result[start + "<lemma>".len() + end + "</lemma>".len()..]
            );
        } else {
            result = result[..start].to_string();
            break;
        }
    }

    result = result.trim().to_string();

    // Some models output chain-of-thought as plain text before the title.
    // Take only the last non-empty line - the actual title.
    let lines: Vec<&str> = result
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();
    lines.last().map(|l| l.to_string()).unwrap_or(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_short_title_unchanged() {
        assert_eq!(
            truncate_title_words("one two three four five", 5),
            "one two three four five"
        );
    }

    #[test]
    fn truncate_uses_colon_separator() {
        assert_eq!(
            truncate_title_words("ChatGPT: Large Language Model from OpenAI", 5),
            "ChatGPT"
        );
    }

    #[test]
    fn truncate_uses_dash_separator() {
        assert_eq!(
            truncate_title_words("ChatGPT - Large Language Model", 5),
            "ChatGPT"
        );
    }

    #[test]
    fn truncate_fallback_first_n_words() {
        assert_eq!(
            truncate_title_words("one two three four five six seven", 5),
            "one two three four five"
        );
    }

    #[test]
    fn reasoning_detected_for_starter() {
        assert!(looks_like_reasoning("Okay, so the title is"));
        assert!(looks_like_reasoning("Let me think about this"));
    }

    #[test]
    fn reasoning_not_detected_for_title() {
        assert!(!looks_like_reasoning("Python Loops"));
        assert!(!looks_like_reasoning("Climate Change"));
    }
}
