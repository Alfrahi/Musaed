//! RAG project CRUD services.

use std::sync::Arc;

use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use crate::rag::store::RagStore;
use crate::rag::types::RagProject;
use crate::rag::validation::{rag_validation_error, validate_add_project, validate_project_id};
use tokio::sync::RwLock;

pub struct AddProjectRequest {
    pub name: String,
    pub path: String,
    pub embedding_model: String,
    pub ignore_patterns: Vec<String>,
    pub store: Arc<RwLock<RagStore>>,
}

pub struct RemoveProjectRequest {
    pub project_id: String,
    pub store: Arc<RwLock<RagStore>>,
}

pub struct UpdateProjectRequest {
    pub project_id: String,
    pub name: Option<String>,
    pub ignore_patterns: Option<Vec<String>>,
    pub store: Arc<RwLock<RagStore>>,
}

pub struct ListProjectsRequest {
    pub store: Arc<RwLock<RagStore>>,
}

pub async fn add_project(req: AddProjectRequest) -> ApiResponse<RagProject> {
    if let Err(e) = validate_add_project(
        &req.name,
        &req.path,
        &req.embedding_model,
        &req.ignore_patterns,
    ) {
        return rag_validation_error(e);
    }
    let canonical_path = match std::path::Path::new(&req.path).canonicalize() {
        Ok(p) => p,
        Err(e) => return rag_validation_error(format!("Failed to resolve project path: {}", e)),
    };
    if !canonical_path.is_dir() {
        return rag_validation_error("Project path must be a valid directory".to_string());
    }
    let s = req.store.write().await;
    match s
        .create_project_with_params(
            &req.name,
            &req.path,
            &req.embedding_model,
            &req.ignore_patterns,
        )
        .await
    {
        Ok(project) => ApiResponse {
            success: true,
            data: Some(project),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(
                BackendError::new(error_codes::RAG_CREATE_ERROR, e)
                    .with_context("Failed to create RAG project".to_string()),
            ),
        },
    }
}

pub async fn remove_project(req: RemoveProjectRequest) -> ApiResponse<bool> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return rag_validation_error(e);
    }
    let s = req.store.write().await;
    match s.delete_project(&req.project_id).await {
        Ok(()) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(
                BackendError::new(error_codes::RAG_DELETE_ERROR, e)
                    .with_context("Failed to delete RAG project".to_string()),
            ),
        },
    }
}

pub async fn update_project(req: UpdateProjectRequest) -> ApiResponse<RagProject> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return rag_validation_error(e);
    }
    let s = req.store.write().await;
    if let Err(e) = s
        .update_project_metadata(
            &req.project_id,
            req.name.as_deref(),
            req.ignore_patterns.as_deref(),
        )
        .await
    {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(
                BackendError::new(error_codes::RAG_UPDATE_ERROR, e)
                    .with_context("Failed to update RAG project metadata".to_string()),
            ),
        };
    }
    match s.get_project(&req.project_id).await {
        Ok(Some(project)) => ApiResponse {
            success: true,
            data: Some(project),
            error: None,
        },
        Ok(None) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                error_codes::RAG_NOT_FOUND,
                "Project not found",
            )),
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(
                BackendError::new(error_codes::RAG_FETCH_ERROR, e)
                    .with_context("Failed to reload RAG project after update".to_string()),
            ),
        },
    }
}

pub async fn list_projects(req: ListProjectsRequest) -> ApiResponse<Vec<RagProject>> {
    let s = req.store.read().await;
    match s.list_projects().await {
        Ok(projects) => ApiResponse {
            success: true,
            data: Some(projects),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(
                BackendError::new(error_codes::RAG_LIST_ERROR, e)
                    .with_context("Failed to list RAG projects".to_string()),
            ),
        },
    }
}
