//! Domain service for handling Ollama chat and pull aborts.
//! Contains the business logic that was previously inside the Tauri commands.

use crate::ollama::client::{ABORT_HANDLES, PULL_ABORT_HANDLES, REQUEST_CACHE};
use crate::payloads::ApiResponse;
use crate::validation::{is_valid_model_name, is_valid_request_id, validation_error};
use tracing;

/// Abort an ongoing Ollama chat request.
///
/// Returns a successful `ApiResponse<()>` regardless of whether a request
/// was found, preserving the original command semantics.
pub async fn abort_chat(request_id: String) -> ApiResponse<()> {
    tracing::info!("Aborting chat request: {}", request_id);

    if !is_valid_request_id(&request_id) {
        return validation_error(
            "INVALID_INPUT",
            format!("Invalid request_id: {:?}", request_id),
        );
    }

    if let Some((_, token)) = ABORT_HANDLES.remove(&request_id) {
        token.cancel();
        tracing::info!("Chat request {} cancelled successfully", request_id);
    } else {
        tracing::warn!("No active chat found for request_id: {}", request_id);
    }

    REQUEST_CACHE.remove(&request_id);

    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

/// Abort an ongoing model pull.
///
/// Returns a successful `ApiResponse<()>` regardless of whether a pull
/// was found, preserving the original command semantics.
pub async fn abort_pull(name: String) -> ApiResponse<()> {
    tracing::info!("Aborting model pull: {}", name);

    if !is_valid_model_name(&name) {
        return validation_error(
            crate::error_codes::INVALID_INPUT,
            format!("Invalid model name: {:?}", name),
        );
    }

    if let Some((_, token)) = PULL_ABORT_HANDLES.remove(&name) {
        token.cancel();
        tracing::info!("Model pull {} cancelled successfully", name);
    } else {
        tracing::warn!("No active pull found for model: {}", name);
    }

    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}
