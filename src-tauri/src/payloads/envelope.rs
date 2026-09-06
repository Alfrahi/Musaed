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
