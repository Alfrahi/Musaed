//! Input validation constants and helpers for all Tauri IPC commands.
//!
//! Every command that receives data from the frontend must validate its inputs
//! through this module before proceeding. This is the backend's primary defense
//! against malformed, oversized, or malicious payloads.

use crate::payloads::{ApiResponse, BackendError};

// ====================== STRING LENGTH LIMITS ======================

/// Maximum length for model / name strings (e.g. "llama3:latest").
pub const MAX_MODEL_NAME_LEN: usize = 128;

/// Maximum length for a request ID.
pub const MAX_REQUEST_ID_LEN: usize = 128;

/// Maximum length for a single message's content field.
pub const MAX_MESSAGE_CONTENT_LEN: usize = 50 * 1024; // 50 KiB

/// Maximum number of messages in a single chat request.
pub const MAX_MESSAGES_COUNT: usize = 1000;

/// Maximum number of base64-encoded images per single message.
pub const MAX_IMAGES_PER_MESSAGE: usize = 10;

/// Maximum length for a single base64-encoded image string.
pub const MAX_IMAGE_B64_LEN: usize = 10 * 1024 * 1024; // 10 MiB

/// Maximum length for a log entry string.
pub const MAX_LOG_ENTRY_LEN: usize = 10 * 1024; // 10 KiB

/// Maximum length for user/assistant message fragments sent to title generation.
pub const MAX_TITLE_INPUT_LEN: usize = 10 * 1024; // 10 KiB

/// Maximum length for a role string.
pub const MAX_ROLE_LEN: usize = 32;

// ====================== ALLOWED VALUES ======================

/// Valid role strings accepted by the chat endpoint.
pub const VALID_ROLES: &[&str] = &["system", "user", "assistant"];

/// Valid language codes for title generation.
pub const VALID_LANGUAGES: &[&str] = &["en", "ar"];

// ====================== NUMERIC RANGES ======================

/// Allowed range for temperature.
pub const TEMPERATURE_RANGE: (f32, f32) = (0.0, 2.0);

/// Allowed range for top_k.
pub const TOP_K_RANGE: (u32, u32) = (1, 200);

/// Allowed range for top_p.
pub const TOP_P_RANGE: (f32, f32) = (0.0, 1.0);

/// Allowed range for num_predict.
pub const NUM_PREDICT_RANGE: (u32, u32) = (1, 32768);

/// Allowed range for num_ctx.
pub const NUM_CTX_RANGE: (u32, u32) = (1, 131072);

/// Maximum number of stop sequences.
pub const MAX_STOP_SEQUENCES: usize = 10;

/// Maximum length of a single stop sequence string.
pub const MAX_STOP_SEQUENCE_LEN: usize = 256;

// ====================== REGEX PATTERNS ======================

/// Pattern for valid model names: alphanumeric, dash, underscore, colon, dot.
/// Must also be within [`MAX_MODEL_NAME_LEN`].
pub fn is_valid_model_name(name: &str) -> bool {
    if name.is_empty() || name.len() > MAX_MODEL_NAME_LEN {
        return false;
    }
    name.chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == ':' || c == '.')
}

/// Pattern for valid request IDs: alphanumeric with dash and underscore.
pub fn is_valid_request_id(id: &str) -> bool {
    if id.is_empty() || id.len() > MAX_REQUEST_ID_LEN {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Checks whether a role string is one of the allowed values.
pub fn is_valid_role(role: &str) -> bool {
    !role.is_empty() && role.len() <= MAX_ROLE_LEN && VALID_ROLES.contains(&role)
}

/// Checks whether a language code is one of the allowed values.
pub fn is_valid_language(lang: &str) -> bool {
    VALID_LANGUAGES.contains(&lang)
}

// ====================== VALIDATION HELPERS ======================

/// Builds a validation error `ApiResponse`.
pub fn validation_error<T>(code: &str, message: impl Into<String>) -> ApiResponse<T> {
    ApiResponse {
        success: false,
        data: None,
        error: Some(BackendError::new(code, message)),
    }
}

/// Validates all fields of [`ChatOptions`](crate::payloads::ChatOptions).
/// Returns `Ok(())` if all present fields are within range, or a descriptive error.
pub fn validate_chat_options(opts: &crate::payloads::ChatOptions) -> Result<(), String> {
    if let Some(t) = opts.temperature {
        if t < TEMPERATURE_RANGE.0 || t > TEMPERATURE_RANGE.1 {
            return Err(format!(
                "temperature must be between {} and {}, got {}",
                TEMPERATURE_RANGE.0, TEMPERATURE_RANGE.1, t
            ));
        }
    }
    if let Some(k) = opts.top_k {
        if k < TOP_K_RANGE.0 || k > TOP_K_RANGE.1 {
            return Err(format!(
                "top_k must be between {} and {}, got {}",
                TOP_K_RANGE.0, TOP_K_RANGE.1, k
            ));
        }
    }
    if let Some(p) = opts.top_p {
        if p < TOP_P_RANGE.0 || p > TOP_P_RANGE.1 {
            return Err(format!(
                "top_p must be between {} and {}, got {}",
                TOP_P_RANGE.0, TOP_P_RANGE.1, p
            ));
        }
    }
    if let Some(n) = opts.num_predict {
        if n < NUM_PREDICT_RANGE.0 || n > NUM_PREDICT_RANGE.1 {
            return Err(format!(
                "num_predict must be between {} and {}, got {}",
                NUM_PREDICT_RANGE.0, NUM_PREDICT_RANGE.1, n
            ));
        }
    }
    if let Some(n) = opts.num_ctx {
        if n < NUM_CTX_RANGE.0 || n > NUM_CTX_RANGE.1 {
            return Err(format!(
                "num_ctx must be between {} and {}, got {}",
                NUM_CTX_RANGE.0, NUM_CTX_RANGE.1, n
            ));
        }
    }
    if let Some(ref stops) = opts.stop {
        if stops.len() > MAX_STOP_SEQUENCES {
            return Err(format!(
                "stop sequences must not exceed {}, got {}",
                MAX_STOP_SEQUENCES,
                stops.len()
            ));
        }
        for s in stops {
            if s.len() > MAX_STOP_SEQUENCE_LEN {
                return Err(format!(
                    "each stop sequence must be at most {} bytes, got {}",
                    MAX_STOP_SEQUENCE_LEN,
                    s.len()
                ));
            }
        }
    }
    Ok(())
}

/// Validates a single [`ChatMessage`](crate::payloads::ChatMessage).
pub fn validate_chat_message(msg: &crate::payloads::ChatMessage) -> Result<(), String> {
    if !is_valid_role(&msg.role) {
        return Err(format!(
            "invalid role {:?}; expected one of {:?}",
            msg.role, VALID_ROLES
        ));
    }
    if msg.content.len() > MAX_MESSAGE_CONTENT_LEN {
        return Err(format!(
            "message content exceeds {} bytes (got {})",
            MAX_MESSAGE_CONTENT_LEN,
            msg.content.len()
        ));
    }
    if let Some(ref images) = msg.images {
        if images.len() > MAX_IMAGES_PER_MESSAGE {
            return Err(format!(
                "message has {} images, maximum is {}",
                images.len(),
                MAX_IMAGES_PER_MESSAGE
            ));
        }
        for (i, img) in images.iter().enumerate() {
            if img.len() > MAX_IMAGE_B64_LEN {
                return Err(format!(
                    "image {} exceeds {} bytes (got {})",
                    i,
                    MAX_IMAGE_B64_LEN,
                    img.len()
                ));
            }
        }
    }
    Ok(())
}

// ====================== TESTS ======================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::payloads::ChatOptions;

    // --- is_valid_model_name ---

    #[test]
    fn valid_model_names() {
        assert!(is_valid_model_name("llama3"));
        assert!(is_valid_model_name("llama3:latest"));
        assert!(is_valid_model_name("my-model_v2.1"));
        assert!(is_valid_model_name("a"));
    }

    #[test]
    fn invalid_model_names() {
        assert!(!is_valid_model_name(""));
        assert!(!is_valid_model_name("model with spaces"));
        assert!(!is_valid_model_name("model/slash"));
        assert!(!is_valid_model_name(&"x".repeat(MAX_MODEL_NAME_LEN + 1)));
    }

    // --- is_valid_request_id ---

    #[test]
    fn valid_request_ids() {
        assert!(is_valid_request_id("abc123"));
        assert!(is_valid_request_id("req-123_abc"));
        assert!(is_valid_request_id("a"));
    }

    #[test]
    fn invalid_request_ids() {
        assert!(!is_valid_request_id(""));
        assert!(!is_valid_request_id("id with spaces"));
        assert!(!is_valid_request_id("id/special!"));
        assert!(!is_valid_request_id(&"x".repeat(MAX_REQUEST_ID_LEN + 1)));
    }

    // --- is_valid_role ---

    #[test]
    fn valid_roles() {
        assert!(is_valid_role("system"));
        assert!(is_valid_role("user"));
        assert!(is_valid_role("assistant"));
    }

    #[test]
    fn invalid_roles() {
        assert!(!is_valid_role(""));
        assert!(!is_valid_role("admin"));
        assert!(!is_valid_role(&"x".repeat(MAX_ROLE_LEN + 1)));
    }

    // --- is_valid_language ---

    #[test]
    fn valid_languages() {
        assert!(is_valid_language("en"));
        assert!(is_valid_language("ar"));
    }

    #[test]
    fn invalid_languages() {
        assert!(!is_valid_language("fr"));
        assert!(!is_valid_language(""));
        assert!(!is_valid_language("EN"));
    }

    // --- validate_chat_options ---

    #[test]
    fn valid_chat_options_defaults() {
        let opts = ChatOptions::default();
        assert!(validate_chat_options(&opts).is_ok());
    }

    #[test]
    fn valid_chat_options_typical() {
        let opts = ChatOptions {
            temperature: Some(0.7),
            top_k: Some(40),
            top_p: Some(0.9),
            num_predict: Some(2048),
            num_ctx: Some(4096),
            stop: Some(vec!["\n".to_string()]),
        };
        assert!(validate_chat_options(&opts).is_ok());
    }

    #[test]
    fn invalid_temperature_too_high() {
        let opts = ChatOptions {
            temperature: Some(3.0),
            ..Default::default()
        };
        let err = validate_chat_options(&opts).unwrap_err();
        assert!(err.contains("temperature"));
    }

    #[test]
    fn invalid_temperature_negative() {
        let opts = ChatOptions {
            temperature: Some(-0.1),
            ..Default::default()
        };
        let err = validate_chat_options(&opts).unwrap_err();
        assert!(err.contains("temperature"));
    }

    #[test]
    fn invalid_top_k_zero() {
        let opts = ChatOptions {
            top_k: Some(0),
            ..Default::default()
        };
        let err = validate_chat_options(&opts).unwrap_err();
        assert!(err.contains("top_k"));
    }

    #[test]
    fn invalid_top_p_over_one() {
        let opts = ChatOptions {
            top_p: Some(1.5),
            ..Default::default()
        };
        let err = validate_chat_options(&opts).unwrap_err();
        assert!(err.contains("top_p"));
    }

    #[test]
    fn invalid_num_predict_too_high() {
        let opts = ChatOptions {
            num_predict: Some(99999),
            ..Default::default()
        };
        let err = validate_chat_options(&opts).unwrap_err();
        assert!(err.contains("num_predict"));
    }

    #[test]
    fn too_many_stop_sequences() {
        let opts = ChatOptions {
            stop: Some(
                (0..=MAX_STOP_SEQUENCES)
                    .map(|i| format!("stop{}", i))
                    .collect(),
            ),
            ..Default::default()
        };
        let err = validate_chat_options(&opts).unwrap_err();
        assert!(err.contains("stop sequences"));
    }

    #[test]
    fn stop_sequence_too_long() {
        let opts = ChatOptions {
            stop: Some(vec!["x".repeat(MAX_STOP_SEQUENCE_LEN + 1)]),
            ..Default::default()
        };
        let err = validate_chat_options(&opts).unwrap_err();
        assert!(err.contains("stop sequence"));
    }

    // --- validate_chat_message ---

    #[test]
    fn valid_chat_message() {
        let msg = crate::payloads::ChatMessage {
            role: "user".to_string(),
            content: "Hello".to_string(),
            images: None,
        };
        assert!(validate_chat_message(&msg).is_ok());
    }

    #[test]
    fn invalid_chat_message_bad_role() {
        let msg = crate::payloads::ChatMessage {
            role: "hacker".to_string(),
            content: "Hello".to_string(),
            images: None,
        };
        let err = validate_chat_message(&msg).unwrap_err();
        assert!(err.contains("invalid role"));
    }

    #[test]
    fn invalid_chat_message_content_too_long() {
        let msg = crate::payloads::ChatMessage {
            role: "user".to_string(),
            content: "x".repeat(MAX_MESSAGE_CONTENT_LEN + 1),
            images: None,
        };
        let err = validate_chat_message(&msg).unwrap_err();
        assert!(err.contains("message content exceeds"));
    }

    #[test]
    fn invalid_chat_message_too_many_images() {
        let msg = crate::payloads::ChatMessage {
            role: "user".to_string(),
            content: "see this".to_string(),
            images: Some(vec!["data".to_string(); MAX_IMAGES_PER_MESSAGE + 1]),
        };
        let err = validate_chat_message(&msg).unwrap_err();
        assert!(err.contains("images"));
    }

    #[test]
    fn invalid_chat_message_image_too_large() {
        let msg = crate::payloads::ChatMessage {
            role: "user".to_string(),
            content: "see this".to_string(),
            images: Some(vec!["x".repeat(MAX_IMAGE_B64_LEN + 1)]),
        };
        let err = validate_chat_message(&msg).unwrap_err();
        assert!(err.contains("image 0 exceeds"));
    }

    // --- validation_error helper ---

    #[test]
    fn validation_error_response() {
        let resp: ApiResponse<String> = validation_error("INVALID_INPUT", "bad data");
        assert!(!resp.success);
        assert!(resp.data.is_none());
        assert_eq!(resp.error.unwrap().code, "INVALID_INPUT");
    }
}
