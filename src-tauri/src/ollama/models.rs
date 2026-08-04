//! Model listing, pulling, deletion, and service verification.
//!
//! Contains the following Tauri commands:
//! - [`cmd_ollama_get_models`] — list installed models
//! - [`cmd_ollama_pull_model`] — stream-download a model from the registry
//! - [`cmd_ollama_abort_pull`] — cancel an in-progress pull
//! - [`cmd_ollama_delete_model`] — remove a model from the server
//! - [`cmd_ollama_verify_service`] — confirm a URL points to an Ollama instance
//!
//! All commands are thin adapters that delegate business logic to
//! [`super::model_service::ModelService`].

use crate::payloads::{ApiResponse, ModelValidation, OllamaModel};
use tauri::{AppHandle, Runtime};

use super::model_service::{ModelService, PullModelRequest};

// ==================== MODEL LISTING ====================

#[tauri::command]
pub async fn cmd_ollama_get_models(base_url: String) -> ApiResponse<Vec<OllamaModel>> {
    let service = ModelService;
    match service.get_models(&base_url).await {
        Ok(models) => ApiResponse {
            success: true,
            data: Some(models),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

// ==================== MODEL PULLING ====================

#[tauri::command]
pub async fn cmd_ollama_pull_model<R: Runtime>(
    window: tauri::Window<R>,
    app: AppHandle<R>,
    base_url: String,
    name: String,
) -> ApiResponse<()> {
    let service = ModelService;
    let req = PullModelRequest {
        app,
        window_label: window.label().to_string(),
        base_url,
        name,
    };
    match service.pull_model(req).await {
        Ok(()) => ApiResponse {
            success: true,
            data: Some(()),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

#[tauri::command]
pub async fn cmd_ollama_abort_pull(name: String) -> ApiResponse<()> {
    crate::ollama::abort_service::abort_pull(name).await
}

// ==================== MODEL DELETION ====================

#[tauri::command]
pub async fn cmd_ollama_delete_model(base_url: String, name: String) -> ApiResponse<bool> {
    let service = ModelService;
    match service.delete_model(&base_url, &name).await {
        Ok(deleted) => ApiResponse {
            success: true,
            data: Some(deleted),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: Some(false),
            error: Some(e),
        },
    }
}

// ==================== SERVICE VERIFICATION ====================

/// Verifies that the given base URL actually points to an Ollama instance
/// by requesting `/` and checking the `Server` response header.
#[tauri::command]
pub async fn cmd_ollama_verify_service(base_url: String) -> ApiResponse<String> {
    let service = ModelService;
    match service.verify_service(&base_url).await {
        Ok(version) => ApiResponse {
            success: true,
            data: Some(version),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

// ==================== MODEL VALIDATION ====================

/// Validates that a model exists on the Ollama server and returns its
/// metadata, including the `context_length` parsed from `/api/show`.
#[tauri::command]
pub async fn cmd_ollama_validate_model(
    base_url: String,
    name: String,
) -> ApiResponse<ModelValidation> {
    let service = ModelService;
    match service.validate_model(&base_url, &name).await {
        Ok(validation) => ApiResponse {
            success: true,
            data: Some(validation),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}
