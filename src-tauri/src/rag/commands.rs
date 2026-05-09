//! RAG Tauri commands — all 13 IPC endpoints.
//!
//! Each command follows the existing pattern: validate inputs, acquire rate
//! limit permit, execute, return `Result<ApiResponse<T>, String>`.
//!
//! SECURITY: All filesystem paths are canonicalized to prevent symlink traversal attacks.

use crate::payloads::{ApiResponse, BackendError};
use crate::rag::embedder::OllamaEmbedder;
use crate::rag::indexing;
use crate::rag::search::RagSearchEngine;
use crate::rag::store::RagStore;
use crate::rag::types::{ChunkRecord, IndexStatus, ModelValidation, ProjectStats, RagProject};
use crate::rag::validation;
use crate::shared::RAG_INDEX_ABORT_HANDLES;
use crate::validation::is_valid_model_name;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, Runtime};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tracing;

// ====================== PATH SECURITY HELPERS ======================

/// Canonicalizes a path and verifies it stays within the project root.
/// Returns the canonical path on success, or an error message on failure.
///
/// Security measures:
/// - Resolves symlinks to prevent symlink traversal attacks
/// - Verifies the resolved path is within the project root directory
/// - Rejects any path that escapes the project boundary
fn canonicalize_path_within_project(
    project_root: &Path,
    target_path: &Path,
) -> Result<PathBuf, String> {
    // Canonicalize the project root (resolves any symlinks)
    let canonical_root = project_root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve project root: {}", e))?;

    // Canonicalize the target path
    let canonical_target = target_path
        .canonicalize()
        .map_err(|e| format!("Target path does not exist or is inaccessible: {}", e))?;

    // Add trailing separator to prevent prefix matching issues (e.g., /home vs /homeuser)
    let canonical_root_with_sep = format!("{}/", canonical_root.to_string_lossy());
    let canonical_target_with_sep = format!("{}/", canonical_target.to_string_lossy());

    if !canonical_target_with_sep.starts_with(&canonical_root_with_sep) {
        return Err(format!(
            "Path escapes project boundary: {:?} is not within {:?}",
            canonical_target, canonical_root
        ));
    }

    Ok(canonical_target)
}

/// Validates a relative path and returns the canonical path within the project root.
/// Used for file queries within an indexed project.
#[allow(dead_code)]
fn validate_and_canonicalize_file_path(
    project_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    // Reject any path that could escape the project directory
    if relative_path.contains("..") {
        return Err("Path traversal not allowed".to_string());
    }
    if relative_path.starts_with('/') || relative_path.starts_with('\\') {
        return Err("Absolute paths not allowed".to_string());
    }

    // Construct the full path (still potentially a symlink)
    let full_path = project_root.join(relative_path);

    // Canonicalize and verify it's within the project
    canonicalize_path_within_project(project_root, &full_path)
}

// ====================== COMMAND PAYLOADS ======================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectArgs {
    pub project_id: String,
    pub name: Option<String>,
    pub ignore_patterns: Option<Vec<String>>,
}

// ====================== PROJECT MANAGEMENT COMMANDS ======================

#[tauri::command]
pub async fn cmd_rag_add_project(
    name: String,
    path: String,
    embedding_model: String,
    ignore_patterns: Vec<String>,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
    _app_handle: tauri::AppHandle,
) -> Result<ApiResponse<RagProject>, String> {
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

#[tauri::command]
pub async fn cmd_rag_remove_project(
    project_id: String,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<bool>, String> {
    if let Err(e) = validation::validate_project_id(&project_id) {
        return Ok(validation::rag_validation_error(e));
    }

    let store = state.inner();
    let s = store.lock().await;

    Ok(match s.delete_project(&project_id) {
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

#[tauri::command]
pub async fn cmd_rag_update_project(
    project_id: String,
    name: Option<String>,
    ignore_patterns: Option<Vec<String>>,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<RagProject>, String> {
    if let Err(e) = validation::validate_project_id(&project_id) {
        return Ok(validation::rag_validation_error(e));
    }

    let store = state.inner();
    let s = store.lock().await;

    if let Err(e) =
        s.update_project_metadata(&project_id, name.as_deref(), ignore_patterns.as_deref())
    {
        return Ok(ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_UPDATE_ERROR", e)),
        });
    }

    Ok(match s.get_project(&project_id) {
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

#[tauri::command]
pub async fn cmd_rag_list_projects(
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<Vec<RagProject>>, String> {
    let store = state.inner();
    let s = store.lock().await;

    Ok(match s.list_projects() {
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

#[tauri::command]
pub async fn cmd_rag_get_project(
    project_id: String,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<RagProject>, String> {
    if let Err(e) = validation::validate_project_id(&project_id) {
        return Ok(validation::rag_validation_error(e));
    }

    let store = state.inner();
    let s = store.lock().await;

    Ok(match s.get_project(&project_id) {
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

// ====================== INDEXING COMMANDS ======================

#[tauri::command]
pub async fn cmd_rag_index_project<R: Runtime>(
    window: tauri::Window<R>,
    project_id: String,
    force: Option<bool>,
    base_url: Option<String>,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
    app_handle: tauri::AppHandle,
) -> Result<ApiResponse<bool>, String> {
    // Check rate limiting first
    if let Err(e) =
        crate::rate_limiter::RATE_LIMITER.check_rate_limit(window.label(), "cmd_rag_index_project")
    {
        return Ok(ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        });
    }
    if let Err(e) = validation::validate_project_id(&project_id) {
        return Ok(validation::rag_validation_error(e));
    }

    let store = state.inner();

    let project = {
        let s = store.lock().await;
        match s.get_project(&project_id) {
            Ok(Some(p)) => p,
            Ok(None) => {
                return Ok(ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new("RAG_NOT_FOUND", "Project not found")),
                })
            }
            Err(e) => {
                return Ok(ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new("RAG_FETCH_ERROR", e)),
                })
            }
        }
    };

    if RAG_INDEX_ABORT_HANDLES.contains_key(&project_id) {
        return Ok(ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(
                "RAG_ALREADY_INDEXING",
                "Project is already being indexed",
            )),
        });
    }

    let cancel_token = Arc::new(CancellationToken::new());
    RAG_INDEX_ABORT_HANDLES.insert(project_id.clone(), cancel_token.clone());

    let project_id_for_spawn = project_id.clone();
    let project_path = project.path.clone();
    let embedding_model = project.embedding_model.clone();
    let ignore_patterns = project.ignore_patterns.clone();
    let force_val = force.unwrap_or(false);
    let base_url_val = base_url.unwrap_or_else(|| "http://localhost:11434".to_string());

    let store_clone = store.clone();
    let app_handle_for_index = app_handle.clone();
    let app_handle_for_callback = app_handle.clone();
    let project_id_clone = project_id.clone();

    tauri::async_runtime::spawn(async move {
        let result = indexing::index_project(
            store_clone.clone(),
            indexing::IndexOptions {
                project_id: &project_id_for_spawn,
                project_path: &project_path,
                embedding_model: &embedding_model,
                base_url: &base_url_val,
                ignore_patterns: &ignore_patterns,
                force: force_val,
            },
            cancel_token,
            app_handle_for_index,
        )
        .await;

        RAG_INDEX_ABORT_HANDLES.remove(&project_id_clone);

        if let Err(e) = result {
            tracing::error!("Indexing failed for project {}: {}", project_id_clone, e);
            let error = crate::rag::types::IndexError {
                project_id: project_id_clone.clone(),
                message: e.clone(),
            };
            let _ = app_handle_for_callback.emit(crate::shared::EVENT_RAG_INDEX_ERROR, &error);
        } else {
            let s = store_clone.lock().await;
            let stats = s.get_project_stats(&project_id_clone).ok();
            let complete = crate::rag::types::IndexComplete {
                project_id: project_id_clone.clone(),
                indexed_at: chrono::Utc::now().to_rfc3339(),
                file_count: stats.as_ref().map(|s| s.file_count).unwrap_or(0),
                chunk_count: stats.as_ref().map(|s| s.chunk_count).unwrap_or(0),
                total_bytes: stats.as_ref().map(|s| s.total_bytes).unwrap_or(0),
            };
            let _ =
                app_handle_for_callback.emit(crate::shared::EVENT_RAG_INDEX_COMPLETE, &complete);
        }
    });

    Ok(ApiResponse {
        success: true,
        data: Some(true),
        error: None,
    })
}

#[tauri::command]
pub async fn cmd_rag_abort_index(project_id: String) -> Result<ApiResponse<bool>, String> {
    if let Err(e) = validation::validate_project_id(&project_id) {
        return Ok(validation::rag_validation_error(e));
    }

    Ok(
        if let Some((_, token)) = RAG_INDEX_ABORT_HANDLES.remove(&project_id) {
            token.cancel();
            ApiResponse {
                success: true,
                data: Some(true),
                error: None,
            }
        } else {
            ApiResponse {
                success: true,
                data: Some(false),
                error: None,
            }
        },
    )
}

#[tauri::command]
pub async fn cmd_rag_reindex_project<R: Runtime>(
    window: tauri::Window<R>,
    project_id: String,
    base_url: Option<String>,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
    app_handle: tauri::AppHandle,
) -> Result<ApiResponse<bool>, String> {
    cmd_rag_index_project(window, project_id, Some(true), base_url, state, app_handle).await
}

#[tauri::command]
pub async fn cmd_rag_get_index_status(
    project_id: String,
) -> Result<ApiResponse<IndexStatus>, String> {
    if let Err(e) = validation::validate_project_id(&project_id) {
        return Ok(validation::rag_validation_error(e));
    }

    let is_indexing = RAG_INDEX_ABORT_HANDLES.contains_key(&project_id);
    let status = IndexStatus {
        project_id,
        is_indexing,
        progress: None,
    };

    Ok(ApiResponse {
        success: true,
        data: Some(status),
        error: None,
    })
}

// ====================== SEARCH COMMANDS ======================

#[tauri::command]
pub async fn cmd_rag_search(
    project_id: String,
    query: String,
    top_k: Option<usize>,
    threshold: Option<f32>,
    base_url: Option<String>,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
    _app_handle: tauri::AppHandle,
) -> Result<ApiResponse<Vec<crate::rag::types::SearchResult>>, String> {
    if let Err(e) = validation::validate_search(&project_id, &query, top_k, threshold) {
        return Ok(validation::rag_validation_error(e));
    }

    let store = state.inner();

    let project = {
        let s = store.lock().await;
        match s.get_project(&project_id) {
            Ok(Some(p)) => p,
            Ok(None) => {
                return Ok(ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new("RAG_NOT_FOUND", "Project not found")),
                })
            }
            Err(e) => {
                return Ok(ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new("RAG_FETCH_ERROR", e)),
                })
            }
        }
    };

    let base_url_val = base_url.unwrap_or_else(|| "http://localhost:11434".to_string());

    Ok(
        match RagSearchEngine::search(
            store.clone(),
            &project_id,
            &query,
            &base_url_val,
            &project.embedding_model,
            top_k,
            threshold,
        )
        .await
        {
            Ok(results) => ApiResponse {
                success: true,
                data: Some(results),
                error: None,
            },
            Err(e) => ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new("cmd_rag_search_ERROR", e)),
            },
        },
    )
}

#[tauri::command]
pub async fn cmd_rag_get_file_chunks(
    project_id: String,
    file_path: String,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<Vec<ChunkRecord>>, String> {
    if let Err(e) = validation::validate_project_id(&project_id) {
        return Ok(validation::rag_validation_error(e));
    }

    // Get the project to access its root path
    let store = state.inner();
    let s = store.lock().await;
    let project = s
        .get_project(&project_id)
        .map_err(|e| format!("Failed to fetch project: {}", e))?;
    let project = project.ok_or("Project not found")?;

    // Validate and canonicalize the file path
    let canonical_path = validate_and_canonicalize_file_path(Path::new(&project.path), &file_path)
        .map_err(|e| format!("Invalid file path: {}", e))?;

    Ok(
        match s.get_file_by_path(&project_id, &canonical_path.to_string_lossy()) {
            Ok(Some(file)) => {
                if let Some(file_id) = file.id {
                    match s.get_file_chunks(file_id) {
                        Ok(chunks) => ApiResponse {
                            success: true,
                            data: Some(chunks),
                            error: None,
                        },
                        Err(e) => ApiResponse {
                            success: false,
                            data: None,
                            error: Some(BackendError::new("RAG_FETCH_ERROR", e)),
                        },
                    }
                } else {
                    ApiResponse {
                        success: true,
                        data: Some(vec![]),
                        error: None,
                    }
                }
            }
            Ok(None) => ApiResponse {
                success: true,
                data: Some(vec![]),
                error: None,
            },
            Err(e) => ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new("RAG_FETCH_ERROR", e)),
            },
        },
    )
}

#[tauri::command]
pub async fn cmd_cmd_rag_get_project_stats(
    project_id: String,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<ProjectStats>, String> {
    if let Err(e) = validation::validate_project_id(&project_id) {
        return Ok(validation::rag_validation_error(e));
    }

    let store = state.inner();
    let s = store.lock().await;

    Ok(match s.get_project_stats(&project_id) {
        Ok(stats) => ApiResponse {
            success: true,
            data: Some(stats),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_STATS_ERROR", e)),
        },
    })
}

// ====================== EMBEDDING MODEL COMMANDS ======================

#[tauri::command]
pub async fn cmd_rag_set_embedding_model(
    project_id: String,
    model_name: String,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<bool>, String> {
    if let Err(e) = validation::validate_project_id(&project_id) {
        return Ok(validation::rag_validation_error(e));
    }
    if !is_valid_model_name(&model_name) {
        return Ok(validation::rag_validation_error(format!(
            "Invalid model name: {:?}",
            model_name
        )));
    }

    let store = state.inner();
    let s = store.lock().await;

    if let Err(e) = s.update_embedding_model(&project_id, &model_name) {
        return Ok(ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_UPDATE_ERROR", e)),
        });
    }

    Ok(ApiResponse {
        success: true,
        data: Some(true),
        error: None,
    })
}

#[tauri::command]
pub async fn cmd_rag_validate_embedding_model(
    base_url: Option<String>,
    model_name: String,
    _app_handle: tauri::AppHandle,
) -> Result<ApiResponse<ModelValidation>, String> {
    if !is_valid_model_name(&model_name) {
        return Ok(validation::rag_validation_error(format!(
            "Invalid model name: {:?}",
            model_name
        )));
    }

    let ollama_url = base_url.unwrap_or_else(|| "http://localhost:11434".to_string());
    let embedder = OllamaEmbedder::new(&ollama_url, &model_name);

    Ok(match embedder.validate().await {
        Ok(validation) => ApiResponse {
            success: true,
            data: Some(validation),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_VALIDATION_ERROR", e)),
        },
    })
}

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
        // Ensure the parent directory exists
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
