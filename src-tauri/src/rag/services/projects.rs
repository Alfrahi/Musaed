//! RAG project CRUD services.

use std::sync::Arc;

use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use crate::rag::store::RagStore;
use crate::rag::types::RagProject;
use crate::rag::validation::{rag_validation_error, validate_add_project, validate_project_id};
use tokio::sync::RwLock;

pub struct AddProjectRequest<'a> {
    pub name: String,
    pub path: String,
    pub embedding_model: String,
    pub ignore_patterns: Vec<String>,
    pub store: Arc<RwLock<RagStore>>,
    /// Dialog-granted paths (STANDARDS §16): only directories the user
    /// explicitly picked via a native dialog may become RAG project roots.
    /// Without this, the webview could register `/home/user` or `~/.ssh`
    /// and exfiltrate contents via `cmd_rag_get_file_chunks`.
    pub grants: &'a crate::fs::FsAccessGrants,
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

pub async fn add_project(req: AddProjectRequest<'_>) -> ApiResponse<RagProject> {
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
    // Trust anchor: the path must have been surfaced by a native directory
    // dialog this session — never accept a webview-typed path directly.
    if !req.grants.is_granted(&canonical_path) {
        return rag_validation_error(
            "Project path must be selected via the native folder picker".to_string(),
        );
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
                BackendError::new(error_codes::RAG_CREATE_ERROR, e.to_string())
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
                BackendError::new(error_codes::RAG_DELETE_ERROR, e.to_string())
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
                BackendError::new(error_codes::RAG_UPDATE_ERROR, e.to_string())
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
                BackendError::new(error_codes::RAG_FETCH_ERROR, e.to_string())
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
                BackendError::new(error_codes::RAG_LIST_ERROR, e.to_string())
                    .with_context("Failed to list RAG projects".to_string()),
            ),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::FsAccessGrants;

    fn test_store(dir: &std::path::Path) -> Arc<RwLock<RagStore>> {
        let s = RagStore::open(&dir.join("rag_test.sqlite3")).expect("open RagStore");
        Arc::new(RwLock::new(s))
    }

    fn grants_with(paths: &[&std::path::Path]) -> FsAccessGrants {
        let g = FsAccessGrants::default();
        g.grant_paths(paths.iter().map(|p| p.to_string_lossy().into_owned()));
        g
    }

    #[tokio::test]
    async fn add_project_rejects_path_not_dialog_granted() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let store = test_store(tmp.path());
        let grants = FsAccessGrants::default(); // empty — no dialog flow ever ran

        let req = AddProjectRequest {
            name: "proj".into(),
            path: target.path().to_string_lossy().into_owned(),
            embedding_model: "m".into(),
            ignore_patterns: vec![],
            store,
            grants: &grants,
        };
        let resp = add_project(req).await;
        assert!(!resp.success);
        assert_eq!(resp.error.unwrap().code, error_codes::RAG_VALIDATION_ERROR);
    }

    #[tokio::test]
    async fn add_project_accepts_dialog_granted_path() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let store = test_store(tmp.path());
        let grants = grants_with(&[target.path()]);

        let req = AddProjectRequest {
            name: "proj".into(),
            path: target.path().to_string_lossy().into_owned(),
            embedding_model: "m".into(),
            ignore_patterns: vec![],
            store,
            grants: &grants,
        };
        let resp = add_project(req).await;
        assert!(resp.success, "expected success, got {:?}", resp.error);
    }
}
