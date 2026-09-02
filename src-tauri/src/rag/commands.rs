use crate::payloads::ApiResponse;
use crate::rag::services::projects;
use crate::rag::services::*;
use crate::rag::store::RagStore;
use crate::rag::types::{AssembledContext, ChunkRecord, FileRecord, RagProject, SearchResult};
use std::sync::Arc;
use tauri::State;
use tauri::{AppHandle, Runtime};
use tokio::sync::RwLock;

// ====================== PROJECT MANAGEMENT COMMANDS ======================

#[tauri::command]
pub async fn cmd_rag_add_project(
    name: String,
    path: String,
    embedding_model: String,
    ignore_patterns: Vec<String>,
    state: State<'_, Arc<RwLock<RagStore>>>,
    _app_handle: AppHandle,
) -> Result<ApiResponse<RagProject>, String> {
    let req = projects::AddProjectRequest {
        name,
        path,
        embedding_model,
        ignore_patterns,
        store: state.inner().clone(),
    };
    Ok(projects::add_project(req).await)
}

#[tauri::command]
pub async fn cmd_rag_remove_project(
    project_id: String,
    state: State<'_, Arc<RwLock<RagStore>>>,
) -> Result<ApiResponse<bool>, String> {
    let req = projects::RemoveProjectRequest {
        project_id,
        store: state.inner().clone(),
    };
    Ok(projects::remove_project(req).await)
}

#[tauri::command]
pub async fn cmd_rag_update_project(
    project_id: String,
    name: Option<String>,
    ignore_patterns: Option<Vec<String>>,
    state: State<'_, Arc<RwLock<RagStore>>>,
) -> Result<ApiResponse<RagProject>, String> {
    let req = projects::UpdateProjectRequest {
        project_id,
        name,
        ignore_patterns,
        store: state.inner().clone(),
    };
    Ok(projects::update_project(req).await)
}

#[tauri::command]
pub async fn cmd_rag_list_projects(
    state: State<'_, Arc<RwLock<RagStore>>>,
) -> Result<ApiResponse<Vec<RagProject>>, String> {
    let req = projects::ListProjectsRequest {
        store: state.inner().clone(),
    };
    Ok(projects::list_projects(req).await)
}

// ====================== INDEXING COMMANDS ======================

#[tauri::command]
pub async fn cmd_rag_index_project<R: Runtime>(
    window: tauri::Window<R>,
    project_id: String,
    force: Option<bool>,
    base_url: Option<String>,
    state: State<'_, Arc<RwLock<RagStore>>>,
    app_handle: AppHandle,
) -> Result<ApiResponse<bool>, String> {
    // Rate limit enforced once in start_indexing; checking here too would
    // consume two slots per click against the 2-per-minute quota.
    let req = IndexRequest {
        window,
        project_id,
        force,
        base_url,
        state,
        app_handle,
    };
    Ok(start_indexing(req).await)
}

#[tauri::command]
pub async fn cmd_rag_abort_index(project_id: String) -> ApiResponse<bool> {
    let req = AbortIndexRequest { project_id };
    abort_index(req).await
}

#[tauri::command]
pub async fn cmd_rag_reindex_project<R: Runtime>(
    window: tauri::Window<R>,
    project_id: String,
    base_url: Option<String>,
    state: State<'_, Arc<RwLock<RagStore>>>,
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
    Ok(start_indexing(req).await)
}

#[tauri::command]
pub async fn cmd_rag_retry_index_project<R: Runtime>(
    window: tauri::Window<R>,
    project_id: String,
    base_url: Option<String>,
    state: State<'_, Arc<RwLock<RagStore>>>,
    app_handle: AppHandle,
) -> Result<ApiResponse<bool>, String> {
    let req = IndexRequest {
        window,
        project_id,
        force: Some(false), // Don't force reindex, just retry the failed operation
        base_url,
        state,
        app_handle,
    };
    Ok(start_indexing(req).await)
}

// ====================== SEARCH COMMANDS ======================

#[tauri::command]
pub async fn cmd_rag_search(
    project_id: String,
    query: String,
    top_k: Option<usize>,
    threshold: Option<f32>,
    base_url: Option<String>,
    state: State<'_, Arc<RwLock<RagStore>>>,
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
    let start = std::time::Instant::now();
    let res = search(req).await;
    crate::metrics::record_search(start.elapsed().as_millis() as u64);
    Ok(res)
}

#[tauri::command]
pub async fn cmd_rag_get_file_chunks(
    project_id: String,
    file_path: String,
    state: State<'_, Arc<RwLock<RagStore>>>,
) -> Result<ApiResponse<Vec<ChunkRecord>>, String> {
    let req = GetFileChunksRequest {
        project_id,
        file_path,
        state,
    };
    Ok(get_file_chunks(req).await)
}

// ====================== FILE LISTING COMMANDS ======================

#[tauri::command]
pub async fn cmd_rag_list_files(
    project_id: String,
    state: State<'_, Arc<RwLock<RagStore>>>,
) -> Result<ApiResponse<Vec<FileRecord>>, String> {
    let req = ListFilesRequest { project_id, state };
    Ok(list_files(req).await)
}

// ====================== EMBEDDING MODEL COMMANDS ======================

#[tauri::command]
pub async fn cmd_rag_set_embedding_model(
    project_id: String,
    model_name: String,
    state: State<'_, Arc<RwLock<RagStore>>>,
) -> Result<ApiResponse<bool>, String> {
    let req = SetEmbeddingModelRequest {
        project_id,
        model_name,
        state,
    };
    Ok(set_embedding_model(req).await)
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
    state: State<'_, Arc<RwLock<RagStore>>>,
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
    Ok(assemble_context(req).await)
}

// ====================== TESTS (unchanged) ======================

#[cfg(test)]
mod path_security_tests {
    use crate::rag::services::{
        canonicalize_path_within_project, validate_and_canonicalize_file_path,
    };
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
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("escapes project boundary"));
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
        assert!(result.unwrap_err().to_string().contains("traversal"));
    }

    #[test]
    fn test_validate_and_canonicalize_file_path_absolute_blocked() {
        let dir = tempdir().unwrap();
        let project_root = dir.path();
        let result = validate_and_canonicalize_file_path(project_root, "/etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Absolute"));
    }

    #[test]
    fn test_validate_and_canonicalize_file_path_windows_traversal_blocked() {
        let dir = tempdir().unwrap();
        let project_root = dir.path();
        let result = validate_and_canonicalize_file_path(project_root, "..\\..\\Windows\\System32");
        assert!(result.is_err());
    }
}
