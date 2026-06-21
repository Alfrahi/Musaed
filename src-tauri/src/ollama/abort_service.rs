//! Domain service for handling Ollama chat aborts.
//! Contains the business logic that was previously inside the Tauri command.

use crate::ollama::client::{ABORT_HANDLES, REQUEST_CACHE};
use crate::payloads::ApiResponse;
use crate::validation::{is_valid_request_id, validation_error};
use tracing;

/// Abort an ongoing Ollama chat request.
///
/// Returns a successful `ApiResponse<()>` regardless of whether a request
/// was found, preserving the original command semantics.
pub async fn abort_chat(request_id: String) -> ApiResponse<()> {
    tracing::info!("Aborting chat request: {}", request_id);

    // ---- validation ---------------------------------------------------------
    if !is_valid_request_id(&request_id) {
        return validation_error(
            "INVALID_INPUT",
            format!("Invalid request_id: {:?}", request_id),
        );
    }

    // ---- abort handling ------------------------------------------------------
    if let Some((_, token)) = ABORT_HANDLES.remove(&request_id) {
        token.cancel();
        tracing::info!("Chat request {} cancelled successfully", request_id);
    } else {
        tracing::warn!("No active chat found for request_id: {}", request_id);
    }

    // ---- request‑cache cleanup -----------------------------------------------
    REQUEST_CACHE.remove(&request_id);

    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}
