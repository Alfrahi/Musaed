use crate::payloads::ApiResponse;
use crate::rag::services::*;
use crate::rag::store::RagStore;
use crate::rag::types::{
    AssembledContext, ChunkRecord, IndexStatus, ModelValidation, ProjectStats, RagProject,
    SearchResult,
};
use std::sync::Arc;
use tauri::State;
use tauri::{AppHandle, Runtime};
use tokio::sync::Mutex;

// ====================== PROJECT MANAGEMENT COMMANDS ======================

#[tauri::command]
pub async fn cmd_rag_add_project(
    name: String,
    path: String,
    embedding_model: String,
    ignore_patterns: Vec<String>,
    state: State<'_, Arc<Mutex<RagStore>>>,
    _app_handle: AppHandle,
) -> Result<ApiResponse<RagProject>, String> {
    let req = AddProjectRequest {
        name,
        path,
        embedding_model,
        ignore_patterns,
        state,
        app_handle: _app_handle,
    };
    add_project(req).await
}

#[tauri::command]
pub async fn cmd_rag_remove_project(
    project_id: String,
    state: State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<bool>, String> {
    let req = RemoveProjectRequest { project_id, state };
    remove_project(req).await
}

#[tauri::command]
pub async fn cmd_rag_update_project(
    project_id: String,
    name: Option<String>,
    ignore_patterns: Option<Vec<String>>,
    state: State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<RagProject>, String> {
    let req = UpdateProjectRequest {
        project_id,
        name,
        ignore_patterns,
        state,
    };
    update_project(req).await
}

#[tauri::command]
pub async fn cmd_rag_list_projects(
    state: State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<Vec<RagProject>>, String> {
    let req = ListProjectsRequest { state };
    list_projects(req).await
}

#[tauri::command]
pub async fn cmd_rag_get_project(
    project_id: String,
    state: State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<RagProject>, String> {
    let req = GetProjectRequest { project_id, state };
    get_project(req).await
}

// ====================== INDEXING COMMANDS ======================

#[tauri::command]
pub async fn cmd_rag_index_project<R: Runtime>(
    window: tauri::Window<R>,
    project_id: String,
    force: Option<bool>,
    base_url: Option<String>,
    state: State<'_, Arc<Mutex<RagStore>>>,
    app_handle: AppHandle,
) -> Result<ApiResponse<bool>, String> {
    let req = IndexRequest {
        window,
        project_id,
        force,
        base_url,
        state,
        app_handle,
    };
    start_indexing(req).await
}

#[tauri::command]
pub async fn cmd_rag_abort_index(project_id: String) -> Result<ApiResponse<bool>, String> {
    let req = AbortIndexRequest { project_id };
    abort_index(req).await
}

#[tauri::command]
pub async fn cmd_rag_reindex_project<R: Runtime>(
    window: tauri::Window<R>,
    project_id: String,
    base_url: Option<String>,
    state: State<'_, Arc<Mutex<RagStore>>>,
    app_handle: AppHandle,
) -> Result<ApiResponse<bool>, String> {
    let req = IndexRequest {
        window,
        project_id,
        force: Some(true),
        base_url,
        state,
        app_handle,
    };
    start_indexing(req).await
}

#[tauri::command]
pub async fn cmd_rag_get_index_status(
    project_id: String,
) -> Result<ApiResponse<IndexStatus>, String> {
    let req = GetIndexStatusRequest { project_id };
    get_index_status(req).await
}

// ====================== SEARCH COMMANDS ======================

#[tauri::command]
pub async fn cmd_rag_search(
    project_id: String,
    query: String,
    top_k: Option<usize>,
    threshold: Option<f32>,
    base_url: Option<String>,
    state: State<'_, Arc<Mutex<RagStore>>>,
    _app_handle: AppHandle,
) -> Result<ApiResponse<Vec<SearchResult>>, String> {
    let req = SearchRequest {
        project_id,
        query,
        top_k,
        threshold,
        base_url,
        state,
    };
    search(req).await
}

#[tauri::command]
pub async fn cmd_rag_get_file_chunks(
    project_id: String,
    file_path: String,
    state: State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<Vec<ChunkRecord>>, String> {
    let req = GetFileChunksRequest {
        project_id,
        file_path,
        state,
    };
    get_file_chunks(req).await
}

#[tauri::command]
pub async fn cmd_rag_get_project_stats(
    project_id: String,
    state: State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<ProjectStats>, String> {
    let req = GetProjectStatsRequest { project_id, state };
    get_project_stats(req).await
}

// ====================== EMBEDDING MODEL COMMANDS ======================

#[tauri::command]
pub async fn cmd_rag_set_embedding_model(
    project_id: String,
    model_name: String,
    state: State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<bool>, String> {
    let req = SetEmbeddingModelRequest {
        project_id,
        model_name,
        state,
    };
    set_embedding_model(req).await
}

#[tauri::command]
pub async fn cmd_rag_validate_embedding_model(
    base_url: Option<String>,
    model_name: String,
    _app_handle: AppHandle,
) -> Result<ApiResponse<ModelValidation>, String> {
    let req = ValidateEmbeddingModelRequest {
        base_url,
        model_name,
    };
    validate_embedding_model(req).await
}

// ====================== CONTEXT ASSEMBLY COMMANDS ======================

#[tauri::command]
pub async fn cmd_rag_assemble_context(
    project_id: String,
    query: String,
    top_k: Option<usize>,
    threshold: Option<f32>,
    max_chars: Option<usize>,
    base_url: Option<String>,
    state: State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<AssembledContext>, String> {
    let req = AssembleContextRequest {
        project_id,
        query,
        top_k,
        threshold,
        max_chars,
        base_url,
        state,
    };
    assemble_context(req).await
}

// ====================== PATH SECURITY HELPERS ======================

#[cfg(test)]
/// Canonicalizes a path and verifies it stays within the project root.
fn canonicalize_path_within_project(
    project_root: &std::path::Path,
    target_path: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    let canonical_root = project_root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve project root: {}", e))?;
    let canonical_target = target_path
        .canonicalize()
        .map_err(|e| format!("Target path does not exist or is inaccessible: {}", e))?;
    let root_with_sep = format!("{}/", canonical_root.to_string_lossy());
    let target_with_sep = format!("{}/", canonical_target.to_string_lossy());
    if !target_with_sep.starts_with(&root_with_sep) {
        return Err(format!(
            "Path escapes project boundary: {:?} is not within {:?}",
            canonical_target, canonical_root
        ));
    }
    Ok(canonical_target)
}

#[cfg(test)]
/// Validates a relative file path and returns the canonical path within the project root.
fn validate_and_canonicalize_file_path(
    project_root: &std::path::Path,
    relative_path: &str,
) -> Result<std::path::PathBuf, String> {
    if relative_path.contains("..") {
        return Err("Path traversal not allowed".to_string());
    }
    if relative_path.starts_with('/') || relative_path.starts_with('\\') {
        return Err("Absolute paths not allowed".to_string());
    }
    let full_path = project_root.join(relative_path);
    canonicalize_path_within_project(project_root, &full_path)
}

// ====================== TESTS (unchanged) ======================

#[cfg(test)]
mod path_security_tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_canonicalize_path_within_valid_project() {
        let dir = tempdir().unwrap();
        let project_root = dir.path();
        let target = project_root.join("subdir").join("file.txt");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, "test").unwrap();

        let result = canonicalize_path_within_project(project_root, &target);
        assert!(result.is_ok());
        let canonical = result.unwrap();
        assert!(canonical.to_string_lossy().contains("subdir"));
    }

    #[test]
    fn test_canonicalize_path_traversal_blocked() {
        let dir = tempdir().unwrap();
        let project_root = dir.path();
        let target = project_root
            .join("..")
            .join("..")
            .join("etc")
            .join("passwd");

        let result = canonicalize_path_within_project(project_root, &target);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("escapes project boundary"));
    }

    #[test]
    fn test_canonicalize_path_nonexistent_fails() {
        let dir = tempdir().unwrap();
        let project_root = dir.path();
        let target = project_root.join("nonexistent").join("file.txt");

        let result = canonicalize_path_within_project(project_root, &target);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_and_canonicalize_file_path_valid() {
        let dir = tempdir().unwrap();
        let project_root = dir.path();
        fs::create_dir_all(project_root.join("src")).unwrap();
        fs::write(project_root.join("src/main.rs"), "fn main() {}").unwrap();

        let result = validate_and_canonicalize_file_path(project_root, "src/main.rs");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_and_canonicalize_file_path_traversal_blocked() {
        let dir = tempdir().unwrap();
        let project_root = dir.path();
        let result = validate_and_canonicalize_file_path(project_root, "../etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("traversal"));
    }

    #[test]
    fn test_validate_and_canonicalize_file_path_absolute_blocked() {
        let dir = tempdir().unwrap();
        let project_root = dir.path();
        let result = validate_and_canonicalize_file_path(project_root, "/etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Absolute"));
    }

    #[test]
    fn test_validate_and_canonicalize_file_path_windows_traversal_blocked() {
        let dir = tempdir().unwrap();
        let project_root = dir.path();
        let result = validate_and_canonicalize_file_path(project_root, "..\\..\\Windows\\System32");
        assert!(result.is_err());
    }
}
