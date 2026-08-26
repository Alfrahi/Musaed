//! Input validation for conversation-domain IPC commands (STANDARDS §6/§16).
//!
//! Backend defense-in-depth mirroring the client-side Zod schemas in
//! `apps/web/src/lib/ipc.ts`. Limits come from [`crate::generated_validation`]
//! (generated from `packages/contracts/src/validation-limits.ts`) so Rust and
//! TypeScript share one source of truth.

use super::models::{ChatSettings, Conversation, Message};
use crate::error_codes;
use crate::generated_validation::*;
use crate::ollama_url::parse_ollama_base_url;
use crate::payloads::ApiResponse;
use crate::validation::{
    is_valid_model_name, is_valid_request_id, is_valid_role, validation_error,
};

/// Upper bound for persisted entity ids (conversation / message). Generous
/// enough for UUIDs and legacy id formats, tight enough to bound storage keys.
const MAX_ID_LEN: usize = 256;

/// Upper bound on RAG source citations attached to a single message.
const MAX_RAG_SOURCES_PER_MESSAGE: usize = 32;

/// Upper bound for the structured error code carried by a failed message.
const MAX_MESSAGE_ERROR_CODE_LEN: usize = 64;

/// Builds a structured rejection response and emits a warn-level trace so
/// rejected payloads stay observable (STANDARDS §14).
pub fn reject<T>(command: &'static str, msg: String) -> ApiResponse<T> {
    tracing::warn!(command, reason = %msg, "conversation IPC input rejected");
    validation_error(error_codes::INVALID_INPUT, msg)
}

fn valid_entity_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("id must not be empty".to_string());
    }
    if id.len() > MAX_ID_LEN {
        return Err(format!("id exceeds {} bytes", MAX_ID_LEN));
    }
    // Ids are machine-generated; any control character indicates tampering.
    if id.chars().any(char::is_control) {
        return Err("id must not contain control characters".to_string());
    }
    Ok(())
}

pub fn validate_conversation_id(id: &str) -> Result<(), String> {
    valid_entity_id(id)
}

pub fn validate_message_id(id: &str) -> Result<(), String> {
    valid_entity_id(id)
}

pub fn validate_title(title: &str) -> Result<(), String> {
    if title.is_empty() {
        return Err("title must not be empty".to_string());
    }
    if title.len() > MAX_TITLE_INPUT_LEN {
        return Err(format!("title exceeds {} bytes", MAX_TITLE_INPUT_LEN));
    }
    if title.contains('\0') {
        return Err("title must not contain NUL bytes".to_string());
    }
    Ok(())
}

pub fn validate_timestamp(ts: i64, field: &str) -> Result<(), String> {
    if ts <= 0 {
        return Err(format!("{} must be a positive epoch value", field));
    }
    Ok(())
}

pub fn validate_message(msg: &Message) -> Result<(), String> {
    valid_entity_id(&msg.id)?;
    if !is_valid_role(&msg.role) {
        return Err(format!(
            "invalid role {:?}; expected one of {:?}",
            msg.role, VALID_ROLES
        ));
    }
    if msg.content.len() > MAX_MESSAGE_CONTENT_LEN {
        return Err(format!(
            "message content exceeds {} bytes",
            MAX_MESSAGE_CONTENT_LEN
        ));
    }
    validate_timestamp(msg.timestamp, "timestamp")?;

    if let Some(model) = msg.model.as_deref() {
        if !model.is_empty() && !is_valid_model_name(model) {
            return Err(format!("invalid model name {:?}", model));
        }
    }
    if let Some(request_id) = msg.request_id.as_deref() {
        if !request_id.is_empty() && !is_valid_request_id(request_id) {
            return Err(format!("invalid request id {:?}", request_id));
        }
    }

    if let Some(images) = &msg.images {
        if images.len() > MAX_IMAGES_PER_MESSAGE {
            return Err(format!(
                "message has {} images, maximum is {}",
                images.len(),
                MAX_IMAGES_PER_MESSAGE
            ));
        }
        for (i, img) in images.iter().enumerate() {
            if img.len() > MAX_IMAGE_B64_LEN {
                return Err(format!("image {} exceeds {} bytes", i, MAX_IMAGE_B64_LEN));
            }
        }
    }

    if let Some(sources) = &msg.rag_sources {
        if sources.len() > MAX_RAG_SOURCES_PER_MESSAGE {
            return Err(format!(
                "message has {} RAG sources, maximum is {}",
                sources.len(),
                MAX_RAG_SOURCES_PER_MESSAGE
            ));
        }
        for source in sources {
            if source.file_path.len() > MAX_FILE_PATH_LEN {
                return Err(format!(
                    "RAG source path exceeds {} bytes",
                    MAX_FILE_PATH_LEN
                ));
            }
        }
    }

    if let Some(err) = &msg.error {
        if err.code.is_empty() || err.code.len() > MAX_MESSAGE_ERROR_CODE_LEN {
            return Err("message error code length out of range".to_string());
        }
        if err.message.len() > MAX_LOG_ENTRY_LEN {
            return Err(format!(
                "message error text exceeds {} bytes",
                MAX_LOG_ENTRY_LEN
            ));
        }
    }

    Ok(())
}

fn validate_settings(settings: &ChatSettings) -> Result<(), String> {
    if !(TEMPERATURE_RANGE.0 as f64..=TEMPERATURE_RANGE.1 as f64).contains(&settings.temperature) {
        return Err(format!(
            "temperature must be between {} and {}",
            TEMPERATURE_RANGE.0, TEMPERATURE_RANGE.1
        ));
    }
    if settings.top_k < TOP_K_RANGE.0 as i32 || settings.top_k > TOP_K_RANGE.1 as i32 {
        return Err(format!(
            "top_k must be between {} and {}",
            TOP_K_RANGE.0, TOP_K_RANGE.1
        ));
    }
    if !(TOP_P_RANGE.0 as f64..=TOP_P_RANGE.1 as f64).contains(&settings.top_p) {
        return Err(format!(
            "top_p must be between {} and {}",
            TOP_P_RANGE.0, TOP_P_RANGE.1
        ));
    }
    if settings.num_predict < NUM_PREDICT_RANGE.0 || settings.num_predict > NUM_PREDICT_RANGE.1 {
        return Err(format!(
            "num_predict must be between {} and {}",
            NUM_PREDICT_RANGE.0, NUM_PREDICT_RANGE.1
        ));
    }
    if settings.num_ctx < 0
        || (settings.num_ctx as u32) < NUM_CTX_RANGE.0
        || (settings.num_ctx as u32) > NUM_CTX_RANGE.1
    {
        return Err(format!(
            "num_ctx must be between {} and {}",
            NUM_CTX_RANGE.0, NUM_CTX_RANGE.1
        ));
    }
    if settings.stop.len() > MAX_STOP_SEQUENCES {
        return Err(format!(
            "stop sequences must not exceed {}, got {}",
            MAX_STOP_SEQUENCES,
            settings.stop.len()
        ));
    }
    for seq in &settings.stop {
        if seq.len() > MAX_STOP_SEQUENCE_LEN {
            return Err(format!(
                "each stop sequence must be at most {} bytes",
                MAX_STOP_SEQUENCE_LEN
            ));
        }
    }
    if settings.system_prompt.len() > MAX_MESSAGE_CONTENT_LEN {
        return Err(format!(
            "system prompt exceeds {} bytes",
            MAX_MESSAGE_CONTENT_LEN
        ));
    }
    parse_ollama_base_url(&settings.ollama_url)
        .map_err(|e| format!("invalid Ollama URL: {}", e))?;
    if !VALID_LANGUAGES.contains(&settings.language.as_str()) {
        return Err(format!(
            "unsupported language {:?}; expected one of {:?}",
            settings.language, VALID_LANGUAGES
        ));
    }
    if !matches!(settings.theme.as_str(), "light" | "dark" | "system") {
        return Err(format!("unsupported theme {:?}", settings.theme));
    }
    Ok(())
}

pub fn validate_conversation(conversation: &Conversation) -> Result<(), String> {
    valid_entity_id(&conversation.id)?;
    validate_title(&conversation.title)?;
    if !conversation.model.is_empty() && !is_valid_model_name(&conversation.model) {
        return Err(format!("invalid model name {:?}", conversation.model));
    }
    validate_timestamp(conversation.created_at, "createdAt")?;
    validate_timestamp(conversation.updated_at, "updatedAt")?;
    if conversation.messages.len() > MAX_MESSAGES_COUNT {
        return Err(format!(
            "conversation has {} messages, maximum is {}",
            conversation.messages.len(),
            MAX_MESSAGES_COUNT
        ));
    }
    for msg in &conversation.messages {
        validate_message(msg)?;
    }
    validate_settings(&conversation.settings)?;
    Ok(())
}

pub fn validate_search(query: &str, limit: usize) -> Result<(), String> {
    if query.is_empty() {
        return Err("query must not be empty".to_string());
    }
    if query.len() > MAX_SEARCH_QUERY_LEN {
        return Err(format!("query exceeds {} bytes", MAX_SEARCH_QUERY_LEN));
    }
    if limit == 0 || limit > 100 {
        return Err("limit must be between 1 and 100".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation::models::{ChatSettings, Conversation, Message};

    fn base_message() -> Message {
        Message {
            id: "11111111-2222-3333-4444-555555555555".to_string(),
            role: "user".to_string(),
            content: "hello".to_string(),
            images: None,
            timestamp: 1_700_000_000_000,
            model: None,
            done: None,
            request_id: None,
            eval_count: None,
            completion_tokens: None,
            prompt_eval_count: None,
            prompt_tokens: None,
            total_tokens: None,
            total_duration: None,
            eval_duration: None,
            rag_sources: None,
            error: None,
        }
    }

    fn base_conversation() -> Conversation {
        Conversation {
            id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".to_string(),
            title: "Test chat".to_string(),
            model: "llama3".to_string(),
            settings: ChatSettings::default(),
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_500,
            messages: vec![base_message()],
        }
    }

    // --- ids ---

    #[test]
    fn accepts_uuid_ids() {
        assert!(validate_conversation_id("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").is_ok());
        assert!(validate_message_id("m-1").is_ok());
    }

    #[test]
    fn rejects_bad_ids() {
        assert!(validate_conversation_id("").is_err());
        assert!(validate_conversation_id(&"x".repeat(MAX_ID_LEN + 1)).is_err());
        assert!(validate_conversation_id("line1\nline2").is_err());
    }

    // --- titles ---

    #[test]
    fn accepts_multiline_title_rejects_nul_and_oversize() {
        assert!(validate_title("Line one\nLine two").is_ok());
        assert!(validate_title("").is_err());
        assert!(validate_title("bad\0title").is_err());
        assert!(validate_title(&"x".repeat(MAX_TITLE_INPUT_LEN + 1)).is_err());
    }

    // --- messages ---

    #[test]
    fn accepts_full_featured_message() {
        let mut msg = base_message();
        msg.role = "assistant".to_string();
        msg.model = Some("llama3:latest".to_string());
        msg.request_id = Some("req-123".to_string());
        msg.images = Some(vec!["aGVsbG8=".to_string()]);
        msg.rag_sources = Some(vec![super::super::models::RagSource {
            file_path: "src/main.rs".to_string(),
            start_line: 1,
            end_line: 10,
            language: Some("rust".to_string()),
        }]);
        msg.error = Some(super::super::models::MessageError {
            code: "OLLAMA_ERROR".to_string(),
            message: "backend exploded".to_string(),
        });
        assert!(validate_message(&msg).is_ok());
    }

    #[test]
    fn rejects_invalid_role_content_and_timestamp() {
        let mut msg = base_message();
        msg.role = "admin".to_string();
        assert!(validate_message(&msg).is_err());

        let mut msg = base_message();
        msg.content = "x".repeat(MAX_MESSAGE_CONTENT_LEN + 1);
        assert!(validate_message(&msg).is_err());

        let mut msg = base_message();
        msg.timestamp = 0;
        assert!(validate_message(&msg).is_err());
    }

    #[test]
    fn rejects_image_count_and_size_violations() {
        let mut msg = base_message();
        msg.images = Some(vec!["a".to_string(); MAX_IMAGES_PER_MESSAGE + 1]);
        assert!(validate_message(&msg).is_err());

        let mut msg = base_message();
        msg.images = Some(vec!["x".repeat(MAX_IMAGE_B64_LEN + 1)]);
        assert!(validate_message(&msg).is_err());
    }

    #[test]
    fn rejects_rag_source_and_error_field_violations() {
        let mut msg = base_message();
        msg.rag_sources = Some(vec![super::super::models::RagSource {
            file_path: "/".repeat(MAX_FILE_PATH_LEN + 1),
            start_line: 1,
            end_line: 2,
            language: None,
        }]);
        assert!(validate_message(&msg).is_err());

        let mut msg = base_message();
        msg.error = Some(super::super::models::MessageError {
            code: "X".repeat(MAX_MESSAGE_ERROR_CODE_LEN + 1),
            message: "boom".to_string(),
        });
        assert!(validate_message(&msg).is_err());
    }

    // --- conversations ---

    #[test]
    fn accepts_default_shaped_conversation() {
        assert!(validate_conversation(&base_conversation()).is_ok());
    }

    #[test]
    fn rejects_message_count_overflow() {
        let mut conv = base_conversation();
        conv.messages = vec![base_message(); MAX_MESSAGES_COUNT + 1];
        assert!(validate_conversation(&conv).is_err());
    }

    // --- settings ---

    type SettingsMutation = Box<dyn Fn(&mut ChatSettings)>;

    #[test]
    fn rejects_out_of_range_sampling_params() {
        let cases: Vec<SettingsMutation> = vec![
            Box::new(|s: &mut ChatSettings| s.temperature = 5.0),
            Box::new(|s: &mut ChatSettings| s.top_k = -1),
            Box::new(|s: &mut ChatSettings| s.top_p = 2.0),
            Box::new(|s: &mut ChatSettings| s.num_predict = -2),
            Box::new(|s: &mut ChatSettings| s.num_ctx = -4),
            Box::new(|s: &mut ChatSettings| s.stop = vec!["x".to_string(); MAX_STOP_SEQUENCES + 1]),
            Box::new(|s: &mut ChatSettings| {
                s.system_prompt = "x".repeat(MAX_MESSAGE_CONTENT_LEN + 1)
            }),
            Box::new(|s: &mut ChatSettings| s.ollama_url = "https://example.com".to_string()),
            Box::new(|s: &mut ChatSettings| s.language = "fr".to_string()),
            Box::new(|s: &mut ChatSettings| s.theme = "neon".to_string()),
        ];
        for mutate in cases {
            let mut settings = ChatSettings::default();
            mutate(&mut settings);
            assert!(validate_settings(&settings).is_err(), "expected rejection");
        }
    }

    // --- search ---

    #[test]
    fn validates_search_inputs() {
        assert!(validate_search("token budget", 50).is_ok());
        assert!(validate_search("", 50).is_err());
        assert!(validate_search(&"q".repeat(MAX_SEARCH_QUERY_LEN + 1), 50).is_err());
        assert!(validate_search("q", 0).is_err());
        assert!(validate_search("q", 101).is_err());
    }

    // --- reject helper ---

    #[test]
    fn reject_builds_structured_response() {
        let resp: ApiResponse<()> = reject("cmd_test", "nope".to_string());
        assert!(!resp.success);
        assert_eq!(resp.error.unwrap().code, error_codes::INVALID_INPUT);
    }
}
