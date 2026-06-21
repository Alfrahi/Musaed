//! Service layer for RAG project management commands.
//! Provides thin, reusable functions that contain all business logic
//! (validation, path handling, store interaction). The Tauri command
//! handlers in `rag/commands.rs` become thin adapters that construct
//! request structs and forward to these functions.

use crate::payloads::{ApiResponse, BackendError};
use crate::rag::types::{RagProject, IndexStatus, ProjectStats, ModelValidation, AssembledContext};
use crate::rag::validation;
use crate::shared::RAG_INDEX_ABORT_HANDLES;
use crate::validation::is_valid_model_name;
use crate::rag::store::RagStore;
use crate::rag::context_assembler;
use crate::rag::embedder::OllamaEmbedder;
use crate::rag::search::RagSearchEngine;
use crate::rag::types::{ChunkRecord, SearchResult};
use crate::rag::services::IndexRequest; // reuse the request struct defined elsewhere for indexing
use std::path::Path;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

/// Adds a new RAG project.
pub async fn add_project(
    name: String,
    path: String,
    embedding_model: String,
    ignore_patterns: Vec<String>,
    state: State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<RagProject>, String> {
    // Validation
    if let Err(e) =
        validation::validate_add_project(&name, &path, &embedding_model, &ignore_patterns)
    {
        return Ok(validation::rag_validation_error(e));
    }

    // Canonicalize the path and ensure it is a valid directory
    let canonical_path = Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve project path: {}", e))?;
    if !canonical_path.is_dir() {
        return Ok(validation::rag_validation_error(
            "Project path must be a valid directory".to_string(),
        ));
    }

    let store = state.inner();
    let s = store.lock().await;

    match s
        .create_project_with_params(&name, &path, &embedding_model, &ignore_patterns)
        .await
    {
        Ok(project) => Ok(ApiResponse {
            success: true,
            data: Some(project),
            error: None,
        }),
        Err(e) => Ok(ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_CREATE_ERROR", e)),
        }),
    }
}

/// Removes an existing RAG project.
pub async fn remove_project(
    project_id: String,
    state: State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<bool>, String> {
    if let Err(e) = validation::validate_project_id(&project_id) {
        return Ok(validation::rag_validation_error(e));
    }

    let store = state.inner();
    let s = store.lock().await;

    Ok(match s.delete_project(&project_id).await {
        Ok(()) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_DELETE_ERROR", e)),
        },
    })
}

/// Updates metadata of a RAG project.
pub async fn update_project(
    project_id: String,
    name: Option<String>,
    ignore_patterns: Option<Vec<String>>,
    state: State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<RagProject>, String> {
    if let Err(e) = validation::validate_project_id(&project_id) {
        return Ok(validation::rag_validation_error(e));
    }

    let store = state.inner();
    let s = store.lock().await;

    if let Err(e) = s
        .update_project_metadata(&project_id, name.as_deref(), ignore_patterns.as_deref())
        .await
    {
        return Ok(ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_UPDATE_ERROR", e)),
        }));
    }

    Ok(match s.get_project(&project_id).await {
        Ok(Some(project)) => ApiResponse {
            success: true,
            data: Some(project),
            error: None,
        },
        Ok(None) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_NOT_FOUND", "Project not found")),
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_FETCH_ERROR", e)),
        },
    })
}

/// Lists all RAG projects.
pub async fn list_projects(
    state: State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<Vec<RagProject>>, String> {
    let store = state.inner();
    let s = store.lock().await;

    Ok(match s.list_projects().await {
        Ok(projects) => ApiResponse {
            success: true,
            data: Some(projects),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_LIST_ERROR", e)),
        },
    })
}

/// Retrieves a single RAG project by ID.
pub async fn get_project(
    project_id: String,
    state: State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<RagProject>, String> {
    if let Err(e) = validation::validate_project_id(&project_id) {
        return Ok(validation::rag_validation_error(e));
    }

    let store = state.inner();
    let s = store.lock().await;

    Ok(match s.get_project(&project_id).await {
        Ok(Some(project)) => ApiResponse {
            success: true,
            data: Some(project),
            error: None,
        },
        Ok(None) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_NOT_FOUND", "Project not found")),
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_FETCH_ERROR", e)),
        },
    })
}
