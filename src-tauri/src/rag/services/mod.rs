//! RAG domain services – thin wrappers that contain the business logic formerly
//! inlined in Tauri commands. Each public async function mirrors a Tauri command
//! but operates on request structs that bundle the original arguments.
//!
//! Project CRUD lives in [`projects`]; indexing, search, embedding-model, and
//! stats each have their own sub-module.

pub mod projects;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use crate::rag::context_assembler;
use crate::rag::error::RagError;
use crate::rag::indexing::{self, IndexOptions};
use crate::rag::search::RagSearchEngine;
use crate::rag::store::RagStore;
use crate::rag::types::{AssembledContext, ChunkRecord, FileRecord, IndexError, SearchResult};
use crate::rag::validation::{
    rag_validation_error, validate_assemble_context, validate_project_id, validate_search,
};
use crate::rate_limiter::RATE_LIMITER;
use tauri::{Emitter, Runtime};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
use tracing;

/// Maximum number of retries for the indexing pipeline on transient failures.
const INDEX_MAX_RETRIES: u32 = 3;

/// Initial backoff in milliseconds for indexing retries (exponential with jitter).
const INDEX_RETRY_BACKOFF_MS: u64 = 2000;

/// Canonicalizes a path and verifies it stays within the project root.
pub(crate) fn canonicalize_path_within_project(
    project_root: &Path,
    target_path: &Path,
) -> Result<PathBuf, RagError> {
    let canonical_root = project_root
        .canonicalize()
        .map_err(|e| RagError::Config(format!("Failed to resolve project root: {}", e)))?;
    let canonical_target = target_path.canonicalize().map_err(|e| {
        RagError::Config(format!(
            "Target path does not exist or is inaccessible: {}",
            e
        ))
    })?;
    let root_with_sep = format!("{}/", canonical_root.to_string_lossy());
    let target_with_sep = format!("{}/", canonical_target.to_string_lossy());
    if !target_with_sep.starts_with(&root_with_sep) {
        return Err(RagError::Config(format!(
            "Path escapes project boundary: {:?} is not within {:?}",
            canonical_target, canonical_root
        )));
    }
    Ok(canonical_target)
}

/// Validates a relative file path and returns the canonical path within the project.
pub(crate) fn validate_and_canonicalize_file_path(
    project_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, RagError> {
    if relative_path.contains("..") {
        return Err(RagError::Config("Path traversal not allowed".to_string()));
    }
    if relative_path.starts_with('/') || relative_path.starts_with('\\') {
        return Err(RagError::Config("Absolute paths not allowed".to_string()));
    }
    let full_path = project_root.join(relative_path);
    canonicalize_path_within_project(project_root, &full_path)
}

// ---------- Request structs ----------
pub struct IndexRequest<'a, R: Runtime> {
    pub window: tauri::Window<R>,
    pub project_id: String,
    pub force: Option<bool>,
    pub base_url: Option<String>,
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
    pub app_handle: tauri::AppHandle,
}

// Project CRUD request structs and functions live in `projects` sub-module.
pub use projects::{
    add_project, list_projects, remove_project, update_project, AddProjectRequest,
    ListProjectsRequest, RemoveProjectRequest, UpdateProjectRequest,
};

pub struct AbortIndexRequest {
    pub project_id: String,
}

pub struct SearchRequest<'a> {
    pub project_id: String,
    pub query: String,
    pub top_k: Option<usize>,
    pub threshold: Option<f32>,
    pub base_url: Option<String>,
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
}

pub struct GetFileChunksRequest<'a> {
    pub project_id: String,
    pub file_path: String,
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
}

pub struct ListFilesRequest<'a> {
    pub project_id: String,
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
}

pub struct SetEmbeddingModelRequest<'a> {
    pub project_id: String,
    pub model_name: String,
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
}

pub struct AssembleContextRequest<'a> {
    pub project_id: String,
    pub query: String,
    pub top_k: Option<usize>,
    pub threshold: Option<f32>,
    pub max_chars: Option<usize>,
    pub base_url: Option<String>,
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
}

// ---------- Implementations ----------

pub async fn abort_index(req: AbortIndexRequest) -> ApiResponse<bool> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return rag_validation_error(e);
    }
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
    }
}

pub async fn reindex_project<'a, R: Runtime>(req: IndexRequest<'a, R>) -> ApiResponse<bool> {
    let mut req = req;
    req.force = Some(true);
    start_indexing(req).await
}

pub async fn start_indexing<'a, R: Runtime>(req: IndexRequest<'a, R>) -> ApiResponse<bool> {
    if let Err(e) = RATE_LIMITER.check_rate_limit(req.window.label(), "cmd_rag_index_project") {
        return rag_validation_error(e.message.clone());
    }
    if let Err(e) = validate_project_id(&req.project_id) {
        return rag_validation_error(e);
    }
    let (project_path, embedding_model, ignore_patterns) = {
        let store = req.state.inner();
        let s = store.read().await;
        match s.get_project(&req.project_id).await {
            Ok(Some(p)) => (
                p.path.clone(),
                p.embedding_model.clone(),
                p.ignore_patterns.clone(),
            ),
            Ok(None) => {
                return ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new(
                        error_codes::RAG_NOT_FOUND,
                        "Project not found",
                    )),
                }
            }
            Err(e) => {
                return ApiResponse {
                    success: false,
                    data: None,
                    error: Some(
                        BackendError::new(error_codes::RAG_FETCH_ERROR, e.to_string())
                            .with_context("Failed to load RAG project for indexing".to_string()),
                    ),
                }
            }
        }
    };
    let cancel_token = Arc::new(CancellationToken::new());
    // If a prior indexing task is still in flight for the same project, cancel
    // it before overwriting the slot. Without this, the previous token would
    // be orphaned and the task would continue running indefinitely with no way
    // to abort it (`abort_index` could only reach the new token).
    if let Some((_, existing)) = crate::shared::RAG_INDEX_ABORT_HANDLES.remove(&req.project_id) {
        existing.cancel();
    }
    crate::shared::RAG_INDEX_ABORT_HANDLES.insert(req.project_id.clone(), cancel_token.clone());

    // Retry loop for transient failures (Ollama timeout, DB lock, etc.)
    let mut last_error = String::new();
    let mut last_error_transient = false;
    let mut backoff_ms = INDEX_RETRY_BACKOFF_MS;

    for attempt in 0..=INDEX_MAX_RETRIES {
        if cancel_token.is_cancelled() {
            last_error = "Indexing cancelled".to_string();
            break;
        }

        if attempt > 0 {
            tracing::warn!(
                "Indexing retry {}/{} for project {} after: {}",
                attempt,
                INDEX_MAX_RETRIES,
                req.project_id,
                last_error
            );
            // Emit a retry progress event so the frontend can show status
            let _ = req.app_handle.emit(
                crate::shared::EVENT_RAG_INDEX_PROGRESS,
                &crate::rag::types::IndexProgress {
                    project_id: req.project_id.clone(),
                    phase: crate::rag::types::IndexPhase::DiscoveringFiles,
                    current: attempt as usize,
                    total: INDEX_MAX_RETRIES as usize,
                    message: format!(
                        "Retrying indexing (attempt {}/{})...",
                        attempt, INDEX_MAX_RETRIES
                    ),
                },
            );
            // Exponential backoff with jitter
            let jitter = (rand::random::<f64>() * 0.1 * backoff_ms as f64) as u64;
            tokio::time::sleep(std::time::Duration::from_millis(backoff_ms + jitter)).await;
            backoff_ms = std::cmp::min(backoff_ms * 2, 30000);
        }

        let result = indexing::index_project(
            req.state.inner().clone(),
            IndexOptions {
                project_id: &req.project_id,
                project_path: &project_path,
                embedding_model: &embedding_model,
                base_url: req.base_url.as_deref().unwrap_or("http://localhost:11434"),
                ignore_patterns: &ignore_patterns,
                force: req.force.unwrap_or(false),
            },
            cancel_token.clone(),
            req.app_handle.clone(),
        )
        .await;

        match result {
            Ok(()) => {
                crate::shared::RAG_INDEX_ABORT_HANDLES.remove(&req.project_id);
                if attempt > 0 {
                    tracing::info!(
                        "Indexing succeeded after {} retry(ies) for project_id: {}",
                        attempt,
                        req.project_id
                    );
                }
                return ApiResponse {
                    success: true,
                    data: Some(true),
                    error: None,
                };
            }
            Err(e) => {
                let is_transient = e.is_transient();
                last_error_transient = is_transient;
                last_error = e.to_string();
                if !is_transient {
                    tracing::error!(
                        "Indexing failed with non-retryable error for project_id {}: {}",
                        req.project_id,
                        last_error
                    );
                    break;
                }
                if attempt == INDEX_MAX_RETRIES {
                    tracing::error!(
                        "Indexing failed after {} retries for project_id {}: {}",
                        INDEX_MAX_RETRIES,
                        req.project_id,
                        last_error
                    );
                    break;
                }
                tracing::warn!(
                    "Indexing attempt {} failed for project_id {}: {}",
                    attempt + 1,
                    req.project_id,
                    last_error
                );
            }
        }
    }

    crate::shared::RAG_INDEX_ABORT_HANDLES.remove(&req.project_id);
    let index_event = IndexError {
        project_id: req.project_id.clone(),
        message: last_error.clone(),
    };
    let _ = req
        .app_handle
        .emit(crate::shared::EVENT_RAG_INDEX_ERROR, &index_event);
    let index_err = BackendError::new(error_codes::RAG_INDEX_ERROR, last_error)
        .with_context("RAG indexing pipeline failed".to_string());
    // Surface retryability so the frontend (now receiving `isRetryable`
    // via the preserved field) can offer a retry affordance for
    // transient failures — connection/timeout/DB-lock categories that
    // `RagError::is_transient()` already classifies.
    let index_err = if last_error_transient {
        index_err.retryable()
    } else {
        index_err
    };
    ApiResponse {
        success: false,
        data: None,
        error: Some(index_err),
    }
}

pub async fn search<'a>(req: SearchRequest<'a>) -> ApiResponse<Vec<SearchResult>> {
    if let Err(e) = validate_search(&req.project_id, &req.query, req.top_k, req.threshold) {
        return rag_validation_error(e);
    }
    let store = req.state.inner();
    let project = {
        let s = store.read().await;
        match s.get_project(&req.project_id).await {
            Ok(Some(p)) => p,
            Ok(None) => {
                return ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new(
                        error_codes::RAG_NOT_FOUND,
                        "Project not found",
                    )),
                }
            }
            Err(e) => {
                return ApiResponse {
                    success: false,
                    data: None,
                    error: Some(
                        BackendError::new(error_codes::RAG_FETCH_ERROR, e.to_string())
                            .with_context("Failed to load RAG project for search".to_string()),
                    ),
                }
            }
        }
    };
    let base_url_val = match req.base_url {
        Some(url) => match crate::ollama_url::parse_ollama_base_url(&url) {
            Ok(u) => u.to_string(),
            Err(e) => return rag_validation_error(e),
        },
        None => "http://localhost:11434".to_string(),
    };
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
            error: Some(
                BackendError::new(error_codes::RAG_SEARCH_ERROR, e.to_string())
                    .with_context("RAG vector search failed".to_string())
                    .retryable(),
            ),
        },
    }
}

pub async fn get_file_chunks<'a>(req: GetFileChunksRequest<'a>) -> ApiResponse<Vec<ChunkRecord>> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return rag_validation_error(e);
    }
    let store = req.state.inner();
    let s = store.read().await;
    let project = match s.get_project(&req.project_id).await {
        Ok(Some(p)) => p,
        Ok(None) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError::new(
                    error_codes::RAG_NOT_FOUND,
                    "Project not found",
                )),
            }
        }
        Err(e) => {
            return ApiResponse {
                success: false,
                data: None,
                error: Some(
                    BackendError::new(error_codes::RAG_FETCH_ERROR, e.to_string())
                        .with_context("Failed to load RAG project for file chunks".to_string()),
                ),
            }
        }
    };
    let canonical_path = match validate_and_canonicalize_file_path(
        std::path::Path::new(&project.path),
        &req.file_path,
    ) {
        Ok(p) => p,
        Err(e) => return rag_validation_error(format!("Invalid file path: {}", e)),
    };
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
                        error: Some(
                            BackendError::new(error_codes::RAG_FETCH_ERROR, e.to_string())
                                .with_context("Failed to load file chunks".to_string()),
                        ),
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
            error: Some(
                BackendError::new(error_codes::RAG_FETCH_ERROR, e.to_string())
                    .with_context("Failed to look up file in RAG store".to_string()),
            ),
        },
    }
}

pub async fn list_files<'a>(req: ListFilesRequest<'a>) -> ApiResponse<Vec<FileRecord>> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return rag_validation_error(e);
    }
    let store = req.state.inner();
    let s = store.read().await;
    match s.get_project_files(&req.project_id).await {
        Ok(files) => ApiResponse {
            success: true,
            data: Some(files),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(
                BackendError::new(error_codes::RAG_FETCH_ERROR, e.to_string())
                    .with_context("Failed to list indexed files".to_string()),
            ),
        },
    }
}

pub async fn set_embedding_model<'a>(req: SetEmbeddingModelRequest<'a>) -> ApiResponse<bool> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return rag_validation_error(e);
    }
    if !crate::validation::is_valid_model_name(&req.model_name) {
        return rag_validation_error(format!("Invalid model name: {:?}", req.model_name));
    }
    let store = req.state.inner();
    let s = store.write().await;
    if let Err(e) = s
        .update_embedding_model(&req.project_id, &req.model_name)
        .await
    {
        return ApiResponse {
            success: false,
            data: None,
            error: Some(
                BackendError::new(error_codes::RAG_UPDATE_ERROR, e.to_string())
                    .with_context("Failed to update RAG embedding model".to_string()),
            ),
        };
    }
    ApiResponse {
        success: true,
        data: Some(true),
        error: None,
    }
}

pub async fn assemble_context<'a>(
    req: AssembleContextRequest<'a>,
) -> ApiResponse<AssembledContext> {
    if let Err(e) = validate_assemble_context(
        &req.project_id,
        &req.query,
        req.top_k,
        req.threshold,
        req.max_chars,
    ) {
        return rag_validation_error(e);
    }
    let store = req.state.inner();
    let project = {
        let s = store.read().await;
        match s.get_project(&req.project_id).await {
            Ok(Some(p)) => p,
            Ok(None) => {
                return ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new(
                        error_codes::RAG_NOT_FOUND,
                        "Project not found",
                    )),
                }
            }
            Err(e) => {
                return ApiResponse {
                    success: false,
                    data: None,
                    error: Some(
                        BackendError::new(error_codes::RAG_FETCH_ERROR, e.to_string())
                            .with_context(
                                "Failed to load RAG project for context assembly".to_string(),
                            ),
                    ),
                }
            }
        }
    };
    let base_url_val = match req.base_url {
        Some(url) => match crate::ollama_url::parse_ollama_base_url(&url) {
            Ok(u) => u.to_string(),
            Err(e) => return rag_validation_error(e),
        },
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
            return ApiResponse {
                success: false,
                data: None,
                error: Some(
                    BackendError::new(error_codes::RAG_SEARCH_ERROR, e.to_string())
                        .with_context("RAG context assembly search failed".to_string())
                        .retryable(),
                ),
            }
        }
    };
    let assembled = context_assembler::assemble_context(&results, &project.path, req.max_chars);
    ApiResponse {
        success: true,
        data: Some(assembled),
        error: None,
    }
}

// Re-export sub‑modules for external use.
// `projects` is declared at the top of this file.
// The old placeholder shims (index.rs, model.rs, search.rs, stats.rs)
// have been removed; project CRUD lives in `projects.rs`.
