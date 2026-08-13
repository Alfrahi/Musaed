use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<BackendError>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackendError {
    pub code: String,
    pub message: String,
    pub request_id: Option<String>,
    pub context: Option<String>,
    pub is_retryable: bool,
}

impl BackendError {
    /// Creates a new error using a canonical error code constant from
    /// [`crate::error_codes`]. The `code` parameter MUST be a `&'static str`
    /// constant defined in that module — raw string literals are rejected by
    /// the type signature to prevent untracked error codes.
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            request_id: None,
            context: None,
            is_retryable: false,
        }
    }

    pub fn with_request_id(mut self, request_id: String) -> Self {
        self.request_id = Some(request_id);
        self
    }

    pub fn with_context(mut self, context: String) -> Self {
        self.context = Some(context);
        self
    }

    pub fn retryable(mut self) -> Self {
        self.is_retryable = true;
        self
    }
}

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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullProgress {
    pub status: String,
    pub digest: Option<String>,
    pub total: Option<u64>,
    pub completed: Option<u64>,
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percentage: Option<f32>,
}

/// Payload for `pull-error` events (matches `PullErrorSchema` in `@musaed/contracts`).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullStreamError {
    pub name: String,
    pub error: String,
    pub duration: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub name: String,
    pub size: Option<u64>,
    pub digest: Option<String>,
    pub details: Option<OllamaModelDetails>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModelDetails {
    pub format: Option<String>,
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OllamaHealth {
    pub is_running: bool,
    pub version: Option<String>,
    pub response_time_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelValidation {
    pub is_valid: bool,
    pub model_name: String,
    pub details: Option<OllamaModelDetails>,
    /// The model's maximum context window, parsed from the `/api/show`
    /// response's `model_info` map. The key is architecture-prefixed
    /// (e.g. `llama.context_length`, `qwen2.context_length`), so the value
    /// is extracted by scanning for any key ending in `.context_length`.
    /// `None` when the field is absent or unsupported by the model.
    pub context_length: Option<u32>,
    /// Per-model sampling defaults parsed from the Modelfile's `PARAMETER`
    /// directives (the top-level `parameters` string returned by
    /// `/api/show`). Each field is `None` when the corresponding
    /// `PARAMETER` directive is absent from the Modelfile or malformed.
    /// `None` on the outer field indicates the `parameters` string was
    /// absent or unparseable in its entirety.
    pub default_params: Option<ModelDefaultParams>,
}

/// Per-model sampling defaults parsed from a Modelfile's `PARAMETER`
/// directives. Mirrors `ModelDefaultParamsSchema` in
/// `packages/contracts/src/schemas/ollama.ts` — keep both sides in
/// lockstep; `pnpm validate:contracts --strict` cross-checks the
/// `ModelValidation` return type end-to-end.
#[derive(Debug, Serialize, Deserialize, Clone, Type, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelDefaultParams {
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub top_k: Option<i32>,
    pub num_ctx: Option<u32>,
    pub num_predict: Option<i32>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error_codes;

    // --- BackendError builder tests ---

    #[test]
    fn backend_error_new() {
        let err = BackendError::new(error_codes::UNKNOWN, "test message");
        assert_eq!(err.code, "UNKNOWN");
        assert_eq!(err.message, "test message");
        assert!(err.request_id.is_none());
        assert!(err.context.is_none());
        assert!(!err.is_retryable);
    }

    #[test]
    fn backend_error_builder_chain() {
        let err = BackendError::new(error_codes::INTERNAL_ERROR, "msg")
            .with_request_id("req-123".to_string())
            .with_context("some context".to_string())
            .retryable();
        assert_eq!(err.request_id.unwrap(), "req-123");
        assert_eq!(err.context.unwrap(), "some context");
        assert!(err.is_retryable);
    }

    #[test]
    fn backend_error_serializes_camel_case() {
        let err = BackendError::new(error_codes::RATE_LIMITED, "msg")
            .with_request_id("r1".to_string())
            .retryable();
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"isRetryable\":true"));
        assert!(json.contains("\"requestId\":\"r1\""));
    }

    // --- ApiResponse tests ---

    #[test]
    fn api_response_success_serialization() {
        let resp = ApiResponse {
            success: true,
            data: Some("hello".to_string()),
            error: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"data\":\"hello\""));
    }

    #[test]
    fn api_response_error_serialization() {
        let resp: ApiResponse<String> = ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(error_codes::INTERNAL_ERROR, "fail")),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":false"));
        assert!(json.contains("\"code\":\"INTERNAL_ERROR\""));
    }

    #[test]
    fn api_response_roundtrip() {
        let resp = ApiResponse {
            success: true,
            data: Some(42),
            error: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        let back: ApiResponse<i32> = serde_json::from_str(&json).unwrap();
        assert!(back.success);
        assert_eq!(back.data.unwrap(), 42);
    }

    // --- ChatMessage tests ---

    #[test]
    fn chat_message_serializes_camel_case() {
        let msg = ChatMessage {
            role: "user".to_string(),
            content: "hello".to_string(),
            images: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(!json.contains("images")); // skip_serializing_if = "Option::is_none"
    }

    #[test]
    fn chat_message_with_images() {
        let msg = ChatMessage {
            role: "user".to_string(),
            content: "see this".to_string(),
            images: Some(vec!["base64data".to_string()]),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"images\":[\"base64data\"]"));
        let back: ChatMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(back.images.unwrap().len(), 1);
    }

    // --- ChatOptions tests ---

    #[test]
    fn chat_options_defaults_all_none() {
        let opts = ChatOptions::default();
        assert!(opts.temperature.is_none());
        assert!(opts.num_predict.is_none());
    }

    #[test]
    fn chat_options_roundtrip() {
        let opts = ChatOptions {
            temperature: Some(0.7),
            top_p: Some(0.9),
            num_ctx: Some(4096),
            ..Default::default()
        };
        let json = serde_json::to_string(&opts).unwrap();
        let back: ChatOptions = serde_json::from_str(&json).unwrap();
        assert_eq!(back.temperature.unwrap(), 0.7);
        assert_eq!(back.num_ctx.unwrap(), 4096);
    }

    #[test]
    fn chat_options_num_predict_negative_one_roundtrip() {
        let opts = ChatOptions {
            num_predict: Some(-1),
            ..Default::default()
        };
        let json = serde_json::to_string(&opts).unwrap();
        assert!(json.contains("\"numPredict\":-1"));
        let back: ChatOptions = serde_json::from_str(&json).unwrap();
        assert_eq!(back.num_predict, Some(-1));
    }

    // --- OllamaToken tests ---

    #[test]
    fn ollama_token_serialization() {
        let token = OllamaToken {
            model: Some("llama3".to_string()),
            created_at: None,
            message: None,
            done: false,
            total_duration: None,
            load_duration: None,
            prompt_eval_count: Some(10),
            prompt_eval_duration: None,
            eval_count: Some(50),
            eval_duration: None,
            prompt_tokens: None,
            total_tokens: None,
            request_id: "req-1".to_string(),
        };
        let json = serde_json::to_string(&token).unwrap();
        assert!(json.contains("\"requestId\":\"req-1\""));
        assert!(json.contains("\"evalCount\":50"));
        let back: OllamaToken = serde_json::from_str(&json).unwrap();
        assert_eq!(back.request_id, "req-1");
        assert!(!back.done);
    }

    /// Verifies that `OllamaToken` can deserialize the snake_case JSON
    /// that Ollama's `/api/chat` endpoint actually returns. The struct
    /// uses `#[serde(rename_all = "camelCase")]` for frontend serialization
    /// but each underscored field carries `#[serde(alias = "...")]` so the
    /// snake_case keys from Ollama are also accepted.
    #[test]
    fn ollama_token_deser_from_ollama_snake_case() {
        let ollama_json = serde_json::json!({
            "model": "llama3",
            "created_at": "2024-01-01T00:00:00Z",
            "message": { "role": "assistant", "content": "Hello" },
            "done": true,
            "total_duration": 5_000_000_000_u64,
            "load_duration": 1_000_000_000_u64,
            "prompt_eval_count": 42,
            "prompt_eval_duration": 100_000_000_u64,
            "eval_count": 10,
            "eval_duration": 500_000_000_u64,
        });
        // Simulate what process_chat_stream does: insert requestId after
        // parsing the raw Ollama line.
        let mut value = ollama_json.clone();
        value["requestId"] = serde_json::json!("req-1");

        let token: OllamaToken = serde_json::from_value(value).unwrap();
        assert_eq!(token.model.as_deref(), Some("llama3"));
        assert_eq!(token.created_at.as_deref(), Some("2024-01-01T00:00:00Z"));
        assert!(token.done);
        assert_eq!(token.total_duration, Some(5_000_000_000));
        assert_eq!(token.load_duration, Some(1_000_000_000));
        assert_eq!(token.prompt_eval_count, Some(42));
        assert_eq!(token.prompt_eval_duration, Some(100_000_000));
        assert_eq!(token.eval_count, Some(10));
        assert_eq!(token.eval_duration, Some(500_000_000));
        assert_eq!(token.request_id, "req-1");

        // Verify the token serializes back to camelCase for the frontend
        let json = serde_json::to_string(&token).unwrap();
        assert!(json.contains("\"promptEvalCount\":42"));
        assert!(json.contains("\"evalCount\":10"));
        assert!(json.contains("\"totalDuration\":5000000000"));
    }

    /// Verifies that `OllamaToken` can also deserialize the semantic alias
    /// names (`completion_tokens`, `prompt_tokens`, `total_tokens`) — newer
    /// Ollama versions may use these names instead of the legacy `eval_count`.
    #[test]
    fn ollama_token_deser_semantic_aliases() {
        let json = serde_json::json!({
            "model": "llama3",
            "done": true,
            "prompt_tokens": 42,
            "completion_tokens": 10,
            "total_tokens": 52,
            "eval_duration": 500_000_000_u64,
            "total_duration": 5_000_000_000_u64,
            "requestId": "req-1",
        });

        let token: OllamaToken = serde_json::from_value(json).unwrap();
        assert_eq!(token.prompt_tokens, Some(42));
        assert_eq!(token.eval_count, Some(10));
        assert_eq!(token.total_tokens, Some(52));
    }

    // --- OllamaModel / OllamaModelDetails tests ---

    #[test]
    fn ollama_model_roundtrip() {
        let model = OllamaModel {
            name: "llama3:latest".to_string(),
            size: Some(4_700_000_000),
            digest: Some("sha256:abc".to_string()),
            details: Some(OllamaModelDetails {
                format: Some("gguf".to_string()),
                family: Some("llama".to_string()),
                parameter_size: Some("8B".to_string()),
                quantization_level: Some("Q4_0".to_string()),
            }),
        };
        let json = serde_json::to_string(&model).unwrap();
        assert!(json.contains("\"parameterSize\":\"8B\""));
        let back: OllamaModel = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "llama3:latest");
        assert_eq!(back.details.unwrap().format.unwrap(), "gguf");
    }

    // --- PullProgress tests ---

    #[test]
    fn pull_progress_serialization() {
        let progress = PullProgress {
            status: "downloading".to_string(),
            digest: Some("sha256:xyz".to_string()),
            total: Some(1000),
            completed: Some(500),
            name: Some("llama3".to_string()),
            percentage: Some(50.0),
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"percentage\":50.0"));
        let back: PullProgress = serde_json::from_str(&json).unwrap();
        assert_eq!(back.status, "downloading");
        assert_eq!(back.percentage.unwrap(), 50.0);
    }

    #[test]
    fn pull_progress_skips_none_percentage() {
        let progress = PullProgress {
            status: "success".to_string(),
            digest: None,
            total: None,
            completed: None,
            name: None,
            percentage: None,
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(!json.contains("percentage"));
    }

    // --- PullStreamError tests ---

    #[test]
    fn pull_stream_error_serialization() {
        let err = PullStreamError {
            name: "model-name".to_string(),
            error: "something failed".to_string(),
            duration: 120,
        };
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"duration\":120"));
    }

    // --- OllamaHealth tests ---

    #[test]
    fn ollama_health_serialization() {
        let health = OllamaHealth {
            is_running: true,
            version: Some("0.5.6".to_string()),
            response_time_ms: 42,
        };
        let json = serde_json::to_string(&health).unwrap();
        assert!(json.contains("\"responseTimeMs\":42"));
        let back: OllamaHealth = serde_json::from_str(&json).unwrap();
        assert!(back.is_running);
        assert_eq!(back.response_time_ms, 42);
    }

    // --- ModelValidation tests ---

    #[test]
    fn model_validation_serialization() {
        let validation = ModelValidation {
            is_valid: true,
            model_name: "llama3".to_string(),
            details: None,
            context_length: None,
            default_params: None,
        };
        let json = serde_json::to_string(&validation).unwrap();
        assert!(json.contains("\"modelName\":\"llama3\""));
        let back: ModelValidation = serde_json::from_str(&json).unwrap();
        assert!(back.is_valid);
    }

    #[test]
    fn model_default_params_roundtrip() {
        let params = ModelDefaultParams {
            temperature: Some(0.8),
            top_p: Some(0.9),
            top_k: Some(40),
            num_ctx: Some(8192),
            num_predict: Some(256),
        };
        let json = serde_json::to_string(&params).unwrap();
        // camelCase serialization
        assert!(json.contains("\"temperature\":0.8"));
        assert!(json.contains("\"topP\":0.9"));
        assert!(json.contains("\"topK\":40"));
        assert!(json.contains("\"numCtx\":8192"));
        assert!(json.contains("\"numPredict\":256"));
        let back: ModelDefaultParams = serde_json::from_str(&json).unwrap();
        assert_eq!(back, params);
    }

    #[test]
    fn model_default_params_defaults_all_none() {
        let params = ModelDefaultParams::default();
        assert!(params.temperature.is_none());
        assert!(params.top_p.is_none());
        assert!(params.top_k.is_none());
        assert!(params.num_ctx.is_none());
        assert!(params.num_predict.is_none());
    }

    #[test]
    fn model_validation_with_default_params_roundtrip() {
        let validation = ModelValidation {
            is_valid: true,
            model_name: "llama3".to_string(),
            details: None,
            context_length: Some(8192),
            default_params: Some(ModelDefaultParams {
                temperature: Some(0.7),
                top_p: None,
                top_k: Some(40),
                num_ctx: None,
                num_predict: Some(-1),
            }),
        };
        let json = serde_json::to_string(&validation).unwrap();
        assert!(json.contains("\"defaultParams\":{"));
        assert!(json.contains("\"numPredict\":-1"));
        let back: ModelValidation = serde_json::from_str(&json).unwrap();
        assert!(back.is_valid);
        let dp = back.default_params.unwrap();
        assert_eq!(dp.temperature.unwrap(), 0.7);
        assert!(dp.top_p.is_none());
        assert_eq!(dp.num_predict.unwrap(), -1);
    }
}
