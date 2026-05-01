use serde::{Deserialize, Serialize};

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
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
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
    pub num_predict: Option<u32>,
    pub num_ctx: Option<u32>,
    pub stop: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OllamaToken {
    pub model: Option<String>,
    pub created_at: Option<String>,
    pub message: Option<ChatMessage>,
    pub done: bool,
    pub total_duration: Option<u64>,
    pub load_duration: Option<u64>,
    pub prompt_eval_count: Option<u32>,
    pub prompt_eval_duration: Option<u64>,
    pub eval_count: Option<u32>,
    pub eval_duration: Option<u64>,
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
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- BackendError builder tests ---

    #[test]
    fn backend_error_new() {
        let err = BackendError::new("TEST_CODE", "test message");
        assert_eq!(err.code, "TEST_CODE");
        assert_eq!(err.message, "test message");
        assert!(err.request_id.is_none());
        assert!(err.context.is_none());
        assert!(!err.is_retryable);
    }

    #[test]
    fn backend_error_builder_chain() {
        let err = BackendError::new("E", "msg")
            .with_request_id("req-123".to_string())
            .with_context("some context".to_string())
            .retryable();
        assert_eq!(err.request_id.unwrap(), "req-123");
        assert_eq!(err.context.unwrap(), "some context");
        assert!(err.is_retryable);
    }

    #[test]
    fn backend_error_serializes_camel_case() {
        let err = BackendError::new("CODE", "msg")
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
            error: Some(BackendError::new("ERR", "fail")),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":false"));
        assert!(json.contains("\"code\":\"ERR\""));
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
            request_id: "req-1".to_string(),
        };
        let json = serde_json::to_string(&token).unwrap();
        assert!(json.contains("\"requestId\":\"req-1\""));
        assert!(json.contains("\"evalCount\":50"));
        let back: OllamaToken = serde_json::from_str(&json).unwrap();
        assert_eq!(back.request_id, "req-1");
        assert!(!back.done);
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
        };
        let json = serde_json::to_string(&validation).unwrap();
        assert!(json.contains("\"modelName\":\"llama3\""));
        let back: ModelValidation = serde_json::from_str(&json).unwrap();
        assert!(back.is_valid);
    }
}
