//! Title generation helpers.
//!
//! Contains [`strip_think_blocks`] for cleaning model output and the
//! [`cmd_ollama_generate_title`] Tauri command that produces a short conversation title.

use crate::payloads::{ApiResponse, BackendError};
use crate::validation::{
    is_valid_language, is_valid_model_name, validation_error, MAX_TITLE_INPUT_LEN,
};
use serde_json::json;
use std::time::Duration;
use tauri::Runtime;
use tracing;

use super::client::{
    acquire_global_permit, invalid_ollama_base, ollama_endpoint, FAST_HTTP_CLIENT,
    FAST_TIMEOUT_SECS,
};

/// Maximum number of words allowed in a generated title.
const MAX_TITLE_WORDS: usize = 5;

/// Prefixes that indicate the model started reasoning instead of generating a
/// title. These are common chain-of-thought sentence starters produced when a
/// model ignores the title-generation prompt and continues the conversation.
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
/// When a model ignores the prompt and produces a sentence instead of a label,
/// blindly taking the first N words yields poor results (e.g. "ChatGPT: Large
/// Language Model from"). Instead, we look for natural separators (colon, dash)
/// and prefer the concise portion before the separator.
fn truncate_title_words(title: &str, max_words: usize) -> String {
    let words: Vec<&str> = title.split_whitespace().collect();
    if words.len() <= max_words {
        return title.to_string();
    }

    // Titles like "ChatGPT: Large Language Model from OpenAI" — the part
    // before the colon is the concise label.
    if let Some(colon_pos) = title.find(':') {
        let before = title[..colon_pos].trim();
        let before_words: Vec<&str> = before.split_whitespace().collect();
        if !before_words.is_empty() && before_words.len() <= max_words {
            return before.to_string();
        }
    }

    // Titles like "ChatGPT - Large Language Model" — same idea with dashes.
    if let Some(dash_pos) = title.find(" - ") {
        let before = title[..dash_pos].trim();
        let before_words: Vec<&str> = before.split_whitespace().collect();
        if !before_words.is_empty() && before_words.len() <= max_words {
            return before.to_string();
        }
    }

    // Fallback: take first N words (better than returning an overly long title).
    words[..max_words].join(" ")
}

/// Strips common thinking/reasoning blocks from model output.
///
/// Handles `<redacted-thinking>`, `<think>` (DeepSeek-R1), `<thoughts>`,
/// `<reasoning>`, `<initial_thoughts>`, plus `<lemma>` blocks,
/// then takes the last non-empty line as the title
/// to discard any preceding chain-of-thought.
pub(crate) fn strip_think_blocks(content: &str) -> String {
    let mut result = content.to_string();

    // Strip <redacted-thinking>...</redacted-thinking> blocks
    // (must match the frontend's `stripThinkingBlocks` logic)
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

    // Strip <think>...</think> blocks (DeepSeek-R1 reasoning format)
    while let Some(start) = result.find("<think>") {
        if let Some(end) = result[start + "<think>".len()..].find("</think>") {
            result = format!(
                "{}{}",
                &result[..start],
                &result[start + "<think>".len() + end + "</think>".len()..]
            );
        } else {
            result = result[..start].to_string();
            break;
        }
    }

    // Strip <thoughts>...</thoughts> blocks
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

    // Strip <reasoning>...</reasoning> blocks
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

    // Strip <initial_thoughts>...</initial_thoughts> blocks
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

    // Strip <lemma>...</lemma> blocks
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

/// Generates a short conversation title by sending the first user message to
/// Ollama with `stream: false`. Uses a system prompt that instructs the model
/// to return only a concise title.
#[tauri::command]
pub async fn cmd_ollama_generate_title<R: Runtime>(
    window: tauri::Window<R>,
    base_url: String,
    model: String,
    user_message: String,
    assistant_message: String,
    language: String,
) -> ApiResponse<String> {
    // Check rate limiting first
    if let Err(e) = crate::rate_limiter::RATE_LIMITER
        .check_rate_limit(window.label(), "cmd_ollama_generate_title")
    {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        };
    }
    tracing::info!("Generating title with model: {}", model);

    // --- Input validation ---
    if !is_valid_model_name(&model) {
        return validation_error("INVALID_INPUT", format!("Invalid model name: {:?}", model));
    }
    if !is_valid_language(&language) {
        return validation_error(
            "INVALID_INPUT",
            format!("Invalid language: {:?}; expected 'en' or 'ar'", language),
        );
    }
    if user_message.len() > MAX_TITLE_INPUT_LEN {
        return validation_error(
            "INVALID_INPUT",
            format!(
                "user_message exceeds {} bytes (got {})",
                MAX_TITLE_INPUT_LEN,
                user_message.len()
            ),
        );
    }
    if assistant_message.len() > MAX_TITLE_INPUT_LEN {
        return validation_error(
            "INVALID_INPUT",
            format!(
                "assistant_message exceeds {} bytes (got {})",
                MAX_TITLE_INPUT_LEN,
                assistant_message.len()
            ),
        );
    }

    let _global_permit = match acquire_global_permit().await {
        Ok(p) => p,
        Err(msg) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new("RATE_LIMITED", msg)),
            }
        }
    };

    let url = match ollama_endpoint(&base_url, "api/chat") {
        Ok(u) => u,
        Err(msg) => return invalid_ollama_base(msg),
    };

    let lang_instruction = if language == "ar" {
        "Respond in Arabic only."
    } else {
        "Respond in English only."
    };

    let system_prompt = format!(
        "You are a title generator. Given a question and answer below, produce a very short \
         descriptive title (5 words max). The title must be a label, not a sentence. \
         Examples: \"Python Loops\", \"Pasta Carbonara Recipe\", \"Climate Change Effects\". \
         Output ONLY the title. No quotes, no punctuation, no explanation. \
         {}",
        lang_instruction
    );

    // Truncate messages to avoid sending excessively long content for title generation
    let truncated_user: String = user_message.chars().take(500).collect();
    let truncated_assistant: String = assistant_message.chars().take(500).collect();

    let user_content = format!(
        "Question: {}\nAnswer: {}",
        truncated_user, truncated_assistant
    );

    let payload = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system_prompt },
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

                    // Strip common thinking/reasoning blocks that some models
                    // (e.g. DeepSeek) emit before the actual title.
                    let title = strip_think_blocks(raw);
                    let stripped = title.trim();

                    if stripped.is_empty() {
                        return ApiResponse {
                            success: false,
                            data: None,
                            error: Some(BackendError::new(
                                "EMPTY_TITLE",
                                "Model returned empty title after stripping thinking blocks",
                            )),
                        };
                    }

                    // If the model ignored the prompt and started reasoning
                    // instead of producing a title, reject the output.
                    if looks_like_reasoning(stripped) {
                        tracing::warn!(
                            "Title output looks like reasoning, rejecting: {:?}",
                            stripped
                        );
                        return ApiResponse {
                            success: false,
                            data: None,
                            error: Some(BackendError::new(
                                "REASONING_INSTEAD_OF_TITLE",
                                "Model produced reasoning instead of a title",
                            )),
                        };
                    }

                    // Enforce the 5-word maximum regardless of model compliance.
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
                        error: Some(BackendError::new("PARSE_ERROR", e.to_string())),
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
                    "OLLAMA_ERROR",
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
                    BackendError::new("NETWORK_ERROR", e.to_string())
                        .with_context("Failed to generate title".to_string())
                        .retryable(),
                ),
            }
        }
    }
}
