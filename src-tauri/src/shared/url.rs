//! Ollama URL resolution helpers.

use crate::error_codes;
use crate::ollama_url::parse_ollama_base_url;
use crate::payloads::{ApiResponse, BackendError};

/// Builds an `ApiResponse` with an `INVALID_URL` error.
pub fn invalid_ollama_base<T>(msg: impl Into<String>) -> ApiResponse<T> {
    ApiResponse {
        success: false,
        data: None,
        error: Some(BackendError::new(error_codes::INVALID_URL, msg.into())),
    }
}

/// Resolves an Ollama API path relative to the validated base URL.
pub fn ollama_endpoint(base_url: &str, path: &str) -> Result<String, String> {
    let base = parse_ollama_base_url(base_url)?;
    base.join(path)
        .map(|u| u.to_string())
        .map_err(|e| e.to_string())
}
