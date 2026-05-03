//! Title generation helpers.
//!
//! Contains [`strip_thinking_blocks`] for cleaning model output and the
//! [`generate_title`] Tauri command that produces a short conversation title.

use crate::payloads::{ApiResponse, BackendError};
use crate::validation::{is_valid_language, is_valid_model_name, validation_error, MAX_TITLE_INPUT_LEN};
use serde_json::json;
use std::time::Duration;

use super::client::{
    acquire_global_permit, invalid_ollama_base, ollama_endpoint, FAST_HTTP_CLIENT, FAST_TIMEOUT_SECS,
};

/// Strips common thinking/reasoning blocks from model output.
///
/// Handles both `<redacted-thinking>` and `<thinkigne` (DeepSeek-R1) tag formats,
/// plus `<lemma>` blocks, then takes the last non-empty line as the title
/// to discard any preceding chain-of-thought.
pub(crate) fn strip_thinking_blocks(content: &str) -> String {
    let mut result = content.to_string();

    // Strip <redacted-thinking>...</redacted-thinking> blocks
    // (must match the frontend's `stripThinkingBlocks` logic)
    while let Some(start) = result.find("<redacted-thinking>") {
        if let Some(end) = result[start + "<redacted-thinking>".len()..].find("</redacted-thinking>") {
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

    // Strip <thinkigne...</thinkigne> blocks (DeepSeek-R1 reasoning format)
    while let Some(start) = result.find("<thinkigne") {
        if let Some(end) = result[start + "<thinkigne".len()..].find("</thinkigne") {
            result = format!(
                "{}{}",
                &result[..start],
                &result[start + "<thinkigne".len() + end + "</thinkigne".len()..]
            );
        } else {
            result = result[..start].to_string();
            break;
        }
    }

    // Strip <lemma>...</lemma> blocks
    while let Some(start) = result.find("<lemma>") {
        if let Some(end) = result[start + "<lemma>".len()..].find("</lemma>") {
            result = format!("{}{}", &result[..start], &result[start + "<lemma>".len() + end + "</lemma>".len()..]);
        } else {
            result = result[..start].to_string();
            break;
        }
    }

    result = result.trim().to_string();

    // Some models output chain-of-thought as plain text before the title.
    // Take only the last non-empty line - the actual title.
    let lines: Vec<&str> = result.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    lines.last().map(|l| l.to_string()).unwrap_or(result)
}

/// Generates a short conversation title by sending the first user message to
/// Ollama with `stream: false`. Uses a system prompt that instructs the model
/// to return only a concise title.
#[tauri::command]
pub async fn generate_title(
    base_url: String,
    model: String,
    user_message: String,
    assistant_message: String,
    language: String,
) -> ApiResponse<String> {
    log::info!("Generating title with model: {}", model);

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
        "You MUST respond in Arabic only."
    } else {
        "You MUST respond in English only."
    };

    let system_prompt = format!(
        "Generate a short title (3-6 words) for this conversation. \
         Output ONLY the title — no thinking, no reasoning, no quotes, no punctuation at the end, no prefix like \"Title:\". \
         {}",
        lang_instruction
    );

    // Truncate messages to avoid sending excessively long content for title generation
    let truncated_user: String = user_message.chars().take(500).collect();
    let truncated_assistant: String = assistant_message.chars().take(500).collect();

    let payload = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": format!("User: {}\nAssistant: {}", truncated_user, truncated_assistant) }
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
                    let title = strip_thinking_blocks(raw);
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

                    log::info!("Generated title: {}", stripped);
                    ApiResponse {
                        success: true,
                        data: Some(stripped.to_string()),
                        error: None,
                    }
                }
                Err(e) => {
                    log::error!("Failed to parse title response: {}", e);
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
            log::error!("Title generation failed with HTTP {}: {}", status, body);
            ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new(
                    "OLLAMA_ERROR",
                    format!("HTTP {}: {}", status, body.chars().take(200).collect::<String>()),
                )),
            }
        }
        Err(e) => {
            log::error!("Title generation request failed: {}", e);
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
