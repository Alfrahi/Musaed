//! RAG domain services – thin wrappers that contain the business logic formerly
//! All command‑level orchestration (validation, rate limiting, abort handling, store interaction)
//! has been moved here. Each public async function mirrors a Tauri command but operates on
//! request structs that bundle the original arguments.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::payloads::{ApiResponse, BackendError};
use crate::rag::context_assembler;
use crate::rag::embedder::OllamaEmbedder;
use crate::rag::indexing::{self, IndexOptions};
use crate::rag::search::RagSearchEngine;
use crate::rag::store::RagStore;
use crate::rag::types::{
    AssembledContext, ChunkRecord, IndexStatus, ModelValidation, ProjectStats, RagProject,
    SearchResult,
};
use crate::rag::validation::{
    rag_validation_error, validate_add_project, validate_assemble_context, validate_project_id,
    validate_search,
};
use crate::rate_limiter::RATE_LIMITER;
use tauri::{Emitter, Runtime};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// Canonicalizes a path and verifies it stays within the project root.
fn canonicalize_path_within_project(
    project_root: &Path,
    target_path: &Path,
) -> Result<PathBuf, String> {
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

/// Validates a relative file path and returns the canonical path within the project.
fn validate_and_canonicalize_file_path(
    project_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    if relative_path.contains("..") {
        return Err("Path traversal not allowed".to_string());
    }
    if relative_path.starts_with('/') || relative_path.starts_with('\\') {
        return Err("Absolute paths not allowed".to_string());
    }
    let full_path = project_root.join(relative_path);
    canonicalize_path_within_project(project_root, &full_path)
}

// ---------- Request structs (already declared in original file) ----------
// (kept here to preserve public API)
pub struct IndexRequest<'a, R: Runtime> {
    pub window: tauri::Window<R>,
    pub project_id: String,
    pub force: Option<bool>,
    pub base_url: Option<String>,
    pub state: tauri::State<'a, Arc<Mutex<RagStore>>>,
    pub app_handle: tauri::AppHandle,
}

pub struct AddProjectRequest<'a> {
    pub name: String,
    pub path: String,
    pub embedding_model: String,
    pub ignore_patterns: Vec<String>,
    pub state: tauri::State<'a, Arc<Mutex<RagStore>>>,
    pub app_handle: tauri::AppHandle,
}

pub struct RemoveProjectRequest<'a> {
    pub project_id: String,
    pub state: tauri::State<'a, Arc<Mutex<RagStore>>>,
}

pub struct UpdateProjectRequest<'a> {
    pub project_id: String,
    pub name: Option<String>,
    pub ignore_patterns: Option<Vec<String>>,
    pub state: tauri::State<'a, Arc<Mutex<RagStore>>>,
}

pub struct ListProjectsRequest<'a> {
    pub state: tauri::State<'a, Arc<Mutex<RagStore>>>,
}

pub struct GetProjectRequest<'a> {
    pub project_id: String,
    pub state: tauri::State<'a, Arc<Mutex<RagStore>>>,
}

pub struct GetIndexStatusRequest {
    pub project_id: String,
}

pub struct AbortIndexRequest {
    pub project_id: String,
}

pub struct SearchRequest<'a> {
    pub project_id: String,
    pub query: String,
    pub top_k: Option<usize>,
    pub threshold: Option<f32>,
    pub base_url: Option<String>,
    pub state: tauri::State<'a, Arc<Mutex<RagStore>>>,
}

pub struct GetFileChunksRequest<'a> {
    pub project_id: String,
    pub file_path: String,
    pub state: tauri::State<'a, Arc<Mutex<RagStore>>>,
}

pub struct GetProjectStatsRequest<'a> {
    pub project_id: String,
    pub state: tauri::State<'a, Arc<Mutex<RagStore>>>,
}

pub struct SetEmbeddingModelRequest<'a> {
    pub project_id: String,
    pub model_name: String,
    pub state: tauri::State<'a, Arc<Mutex<RagStore>>>,
}

pub struct ValidateEmbeddingModelRequest {
    pub base_url: Option<String>,
    pub model_name: String,
}

pub struct AssembleContextRequest<'a> {
    pub project_id: String,
    pub query: String,
    pub top_k: Option<usize>,
    pub threshold: Option<f32>,
    pub max_chars: Option<usize>,
    pub base_url: Option<String>,
    pub state: tauri::State<'a, Arc<Mutex<RagStore>>>,
}

// ---------- Implementations (same as original file) ----------

pub async fn add_project<'a>(
    req: AddProjectRequest<'a>,
) -> Result<ApiResponse<RagProject>, String> {
    if let Err(e) = validate_add_project(
        &req.name,
        &req.path,
        &req.embedding_model,
        &req.ignore_patterns,
    ) {
        return Ok(rag_validation_error(e));
    }
    let canonical_path = std::path::Path::new(&req.path)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve project path: {}", e))?;
    if !canonical_path.is_dir() {
        return Ok(rag_validation_error(
            "Project path must be a valid directory".to_string(),
        ));
    }
    let store = req.state.inner();
    let s = store.lock().await;
    match s
        .create_project_with_params(
            &req.name,
            &req.path,
            &req.embedding_model,
            &req.ignore_patterns,
        )
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

pub async fn remove_project<'a>(
    req: RemoveProjectRequest<'a>,
) -> Result<ApiResponse<bool>, String> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return Ok(rag_validation_error(e));
    }
    let store = req.state.inner();
    let s = store.lock().await;
    Ok(match s.delete_project(&req.project_id).await {
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

pub async fn update_project<'a>(
    req: UpdateProjectRequest<'a>,
) -> Result<ApiResponse<RagProject>, String> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return Ok(rag_validation_error(e));
    }
    let store = req.state.inner();
    let s = store.lock().await;
    if let Err(e) = s
        .update_project_metadata(
            &req.project_id,
            req.name.as_deref(),
            req.ignore_patterns.as_deref(),
        )
        .await
    {
        return Ok(ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_UPDATE_ERROR", e)),
        });
    }
    Ok(match s.get_project(&req.project_id).await {
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

pub async fn list_projects<'a>(
    req: ListProjectsRequest<'a>,
) -> Result<ApiResponse<Vec<RagProject>>, String> {
    let store = req.state.inner();
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

pub async fn get_project<'a>(
    req: GetProjectRequest<'a>,
) -> Result<ApiResponse<RagProject>, String> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return Ok(rag_validation_error(e));
    }
    let store = req.state.inner();
    let s = store.lock().await;
    Ok(match s.get_project(&req.project_id).await {
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

pub async fn get_index_status(
    req: GetIndexStatusRequest,
) -> Result<ApiResponse<IndexStatus>, String> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return Ok(rag_validation_error(e));
    }
    let is_indexing = crate::shared::RAG_INDEX_ABORT_HANDLES.contains_key(&req.project_id);
    Ok(ApiResponse {
        success: true,
        data: Some(IndexStatus {
            project_id: req.project_id,
            is_indexing,
            progress: None,
        }),
        error: None,
    })
}

pub async fn abort_index(req: AbortIndexRequest) -> Result<ApiResponse<bool>, String> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return Ok(rag_validation_error(e));
    }
    Ok(
        if let Some((_, token)) = crate::shared::RAG_INDEX_ABORT_HANDLES.remove(&req.project_id) {
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

pub async fn reindex_project<'a, R: Runtime>(
    req: IndexRequest<'a, R>,
) -> Result<ApiResponse<bool>, String> {
    let mut req = req;
    req.force = Some(true);
    start_indexing(req).await
}

pub async fn start_indexing<'a, R: Runtime>(
    req: IndexRequest<'a, R>,
) -> Result<ApiResponse<bool>, String> {
    if let Err(e) = RATE_LIMITER.check_rate_limit(req.window.label(), "cmd_rag_index_project") {
        return Ok(rag_validation_error(e.message.clone()));
    }
    if let Err(e) = validate_project_id(&req.project_id) {
        return Ok(rag_validation_error(e));
    }
    let (project_path, embedding_model, ignore_patterns) = {
        let store = req.state.inner();
        let s = store.lock().await;
        match s.get_project(&req.project_id).await {
            Ok(Some(p)) => (
                p.path.clone(),
                p.embedding_model.clone(),
                p.ignore_patterns.clone(),
            ),
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
    let cancel_token = Arc::new(CancellationToken::new());
    crate::shared::RAG_INDEX_ABORT_HANDLES.insert(req.project_id.clone(), cancel_token.clone());
    let opts = IndexOptions {
        project_id: &req.project_id,
        project_path: &project_path,
        embedding_model: &embedding_model,
        base_url: req.base_url.as_deref().unwrap_or("http://localhost:11434"),
        ignore_patterns: &ignore_patterns,
        force: req.force.unwrap_or(false),
    };
    let result = indexing::index_project(
        req.state.inner().clone(),
        opts,
        cancel_token.clone(),
        req.app_handle.clone(),
    )
    .await;
    crate::shared::RAG_INDEX_ABORT_HANDLES.remove(&req.project_id);
    match result {
        Ok(_) => Ok(ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        }),
        Err(e) => {
            let _ = req.app_handle.emit(
                crate::shared::EVENT_RAG_INDEX_ERROR,
                &BackendError::new("RAG_INDEX_ERROR", e.clone()),
            );
            Ok(ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new("RAG_INDEX_ERROR", e)),
            })
        }
    }
}

pub async fn search<'a>(req: SearchRequest<'a>) -> Result<ApiResponse<Vec<SearchResult>>, String> {
    if let Err(e) = validate_search(&req.project_id, &req.query, req.top_k, req.threshold) {
        return Ok(rag_validation_error(e));
    }
    let store = req.state.inner();
    let project = {
        let s = store.lock().await;
        match s.get_project(&req.project_id).await {
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
    let base_url_val = match req.base_url {
        Some(url) => crate::ollama_url::parse_ollama_base_url(&url)?.to_string(),
        None => "http://localhost:11434".to_string(),
    };
    Ok(
        match RagSearchEngine::search(
            store.clone(),
            &req.project_id,
            &req.query,
            &base_url_val,
            &project.embedding_model,
            req.top_k,
            req.threshold,
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
                error: Some(BackendError::new("RAG_SEARCH_ERROR", e)),
            },
        },
    )
}

pub async fn get_file_chunks<'a>(
    req: GetFileChunksRequest<'a>,
) -> Result<ApiResponse<Vec<ChunkRecord>>, String> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return Ok(rag_validation_error(e));
    }
    let store = req.state.inner();
    let s = store.lock().await;
    let project = s
        .get_project(&req.project_id)
        .await
        .map_err(|e| format!("Failed to fetch project: {}", e))?;
    let project = match project {
        Some(p) => p,
        None => {
            return Ok(ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new("RAG_NOT_FOUND", "Project not found")),
            })
        }
    };
    let canonical_path =
        validate_and_canonicalize_file_path(std::path::Path::new(&project.path), &req.file_path)
            .map_err(|e| format!("Invalid file path: {}", e))?;
    Ok(
        match s
            .get_file_by_path(&req.project_id, &canonical_path.to_string_lossy())
            .await
        {
            Ok(Some(file)) => {
                if let Some(file_id) = file.id {
                    match s.get_file_chunks(file_id).await {
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

pub async fn get_project_stats<'a>(
    req: GetProjectStatsRequest<'a>,
) -> Result<ApiResponse<ProjectStats>, String> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return Ok(rag_validation_error(e));
    }
    let store = req.state.inner();
    let s = store.lock().await;
    Ok(match s.get_project_stats(&req.project_id).await {
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

pub async fn set_embedding_model<'a>(
    req: SetEmbeddingModelRequest<'a>,
) -> Result<ApiResponse<bool>, String> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return Ok(rag_validation_error(e));
    }
    if !crate::validation::is_valid_model_name(&req.model_name) {
        return Ok(rag_validation_error(format!(
            "Invalid model name: {:?}",
            req.model_name
        )));
    }
    let store = req.state.inner();
    let s = store.lock().await;
    if let Err(e) = s
        .update_embedding_model(&req.project_id, &req.model_name)
        .await
    {
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

pub async fn validate_embedding_model(
    req: ValidateEmbeddingModelRequest,
) -> Result<ApiResponse<ModelValidation>, String> {
    if !crate::validation::is_valid_model_name(&req.model_name) {
        return Ok(rag_validation_error(format!(
            "Invalid model name: {:?}",
            req.model_name
        )));
    }
    let ollama_url = match req.base_url {
        Some(url) => crate::ollama_url::parse_ollama_base_url(&url)?.to_string(),
        None => "http://localhost:11434".to_string(),
    };
    let embedder = OllamaEmbedder::new(&ollama_url, &req.model_name);
    Ok(match embedder.validate().await {
        Ok(val) => ApiResponse {
            success: true,
            data: Some(val),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_VALIDATION_ERROR", e)),
        },
    })
}

pub async fn assemble_context<'a>(
    req: AssembleContextRequest<'a>,
) -> Result<ApiResponse<AssembledContext>, String> {
    if let Err(e) = validate_assemble_context(
        &req.project_id,
        &req.query,
        req.top_k,
        req.threshold,
        req.max_chars,
    ) {
        return Ok(rag_validation_error(e));
    }
    let store = req.state.inner();
    let project = {
        let s = store.lock().await;
        match s.get_project(&req.project_id).await {
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
    let base_url_val = match req.base_url {
        Some(url) => crate::ollama_url::parse_ollama_base_url(&url)?.to_string(),
        None => "http://localhost:11434".to_string(),
    };
    let results = match RagSearchEngine::search(
        store.clone(),
        &req.project_id,
        &req.query,
        &base_url_val,
        &project.embedding_model,
        req.top_k,
        req.threshold,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return Ok(ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new("RAG_SEARCH_ERROR", e)),
            })
        }
    };
    let assembled = context_assembler::assemble_context(&results, &project.path, req.max_chars);
    Ok(ApiResponse {
        success: true,
        data: Some(assembled),
        error: None,
    })
}

// Re-export sub‑modules for external use
pub mod index;
pub mod model;
pub mod search;
pub mod stats;
