//! RAG domain services – thin wrappers that contain the business logic formerly
//! All command‑level orchestration (validation, rate limiting, abort handling, store interaction)
//! has been moved here. Each public async function mirrors a Tauri command but operates on
//! request structs that bundle the original arguments.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};
use crate::rag::context_assembler;
use crate::rag::embedder::OllamaEmbedder;
use crate::rag::indexing::{self, IndexOptions};
use crate::rag::search::RagSearchEngine;
use crate::rag::store::RagStore;
use crate::rag::types::{
    AssembledContext, ChunkRecord, IndexStatus, ProjectStats, RagModelValidation, RagProject,
    SearchResult,
};
use crate::rag::validation::{
    rag_validation_error, validate_add_project, validate_assemble_context, validate_project_id,
    validate_search,
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

/// Returns true if the error is transient (worth retrying) vs permanent.
/// Cancellation, project-not-found, and validation errors are not retried.
fn is_transient_index_error(err: &str) -> bool {
    let lower = err.to_lowercase();
    // Permanent failures — don't retry
    if lower.contains("cancelled") || lower.contains("canceled") {
        return false;
    }
    if lower.contains("not found") || lower.contains("does not exist") {
        return false;
    }
    if lower.contains("invalid") || lower.contains("validation") {
        return false;
    }
    if lower.contains("non-utf-8") || lower.contains("permission denied") {
        return false;
    }
    // Transient failures — retry
    // (timeout, connection refused, embedding failed, DB locked, etc.)
    true
}

/// Canonicalizes a path and verifies it stays within the project root.
pub(crate) fn canonicalize_path_within_project(
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
pub(crate) fn validate_and_canonicalize_file_path(
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
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
    pub app_handle: tauri::AppHandle,
}

pub struct AddProjectRequest<'a> {
    pub name: String,
    pub path: String,
    pub embedding_model: String,
    pub ignore_patterns: Vec<String>,
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
    pub app_handle: tauri::AppHandle,
}

pub struct RemoveProjectRequest<'a> {
    pub project_id: String,
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
}

pub struct UpdateProjectRequest<'a> {
    pub project_id: String,
    pub name: Option<String>,
    pub ignore_patterns: Option<Vec<String>>,
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
}

pub struct ListProjectsRequest<'a> {
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
}

pub struct GetProjectRequest<'a> {
    pub project_id: String,
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
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
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
}

pub struct GetFileChunksRequest<'a> {
    pub project_id: String,
    pub file_path: String,
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
}

pub struct GetProjectStatsRequest<'a> {
    pub project_id: String,
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
}

pub struct SetEmbeddingModelRequest<'a> {
    pub project_id: String,
    pub model_name: String,
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
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
    pub state: tauri::State<'a, Arc<RwLock<RagStore>>>,
}

// ---------- Implementations (same as original file) ----------

pub async fn add_project<'a>(req: AddProjectRequest<'a>) -> ApiResponse<RagProject> {
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
    let store = req.state.inner();
    let s = store.write().await;
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
            error: Some(BackendError::new(error_codes::RAG_CREATE_ERROR, e)),
        },
    }
}

pub async fn remove_project<'a>(req: RemoveProjectRequest<'a>) -> ApiResponse<bool> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return rag_validation_error(e);
    }
    let store = req.state.inner();
    let s = store.write().await;
    match s.delete_project(&req.project_id).await {
        Ok(()) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(error_codes::RAG_DELETE_ERROR, e)),
        },
    }
}

pub async fn update_project<'a>(req: UpdateProjectRequest<'a>) -> ApiResponse<RagProject> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return rag_validation_error(e);
    }
    let store = req.state.inner();
    let s = store.write().await;
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
            error: Some(BackendError::new(error_codes::RAG_UPDATE_ERROR, e)),
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
            error: Some(BackendError::new(error_codes::RAG_FETCH_ERROR, e)),
        },
    }
}

pub async fn list_projects<'a>(req: ListProjectsRequest<'a>) -> ApiResponse<Vec<RagProject>> {
    let store = req.state.inner();
    let s = store.read().await;
    match s.list_projects().await {
        Ok(projects) => ApiResponse {
            success: true,
            data: Some(projects),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(error_codes::RAG_LIST_ERROR, e)),
        },
    }
}

pub async fn get_project<'a>(req: GetProjectRequest<'a>) -> ApiResponse<RagProject> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return rag_validation_error(e);
    }
    let store = req.state.inner();
    let s = store.read().await;
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
            error: Some(BackendError::new(error_codes::RAG_FETCH_ERROR, e)),
        },
    }
}

pub async fn get_index_status(req: GetIndexStatusRequest) -> ApiResponse<IndexStatus> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return rag_validation_error(e);
    }
    let is_indexing = crate::shared::RAG_INDEX_ABORT_HANDLES.contains_key(&req.project_id);
    ApiResponse {
        success: true,
        data: Some(IndexStatus {
            project_id: req.project_id,
            is_indexing,
            progress: None,
        }),
        error: None,
    }
}

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
                    error: Some(BackendError::new(error_codes::RAG_FETCH_ERROR, e)),
                }
            }
        }
    };
    let cancel_token = Arc::new(CancellationToken::new());
    crate::shared::RAG_INDEX_ABORT_HANDLES.insert(req.project_id.clone(), cancel_token.clone());

    // Retry loop for transient failures (Ollama timeout, DB lock, etc.)
    let mut last_error = String::new();
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
                last_error = e.clone();
                if !is_transient_index_error(&e) {
                    tracing::error!(
                        "Indexing failed with non-retryable error for project_id {}: {}",
                        req.project_id,
                        e
                    );
                    break;
                }
                if attempt == INDEX_MAX_RETRIES {
                    tracing::error!(
                        "Indexing failed after {} retries for project_id {}: {}",
                        INDEX_MAX_RETRIES,
                        req.project_id,
                        e
                    );
                    break;
                }
                tracing::warn!(
                    "Indexing attempt {} failed for project_id {}: {}",
                    attempt + 1,
                    req.project_id,
                    e
                );
            }
        }
    }

    crate::shared::RAG_INDEX_ABORT_HANDLES.remove(&req.project_id);
    let _ = req.app_handle.emit(
        crate::shared::EVENT_RAG_INDEX_ERROR,
        &BackendError::new(error_codes::RAG_INDEX_ERROR, last_error.clone()),
    );
    ApiResponse {
        success: false,
        data: None,
        error: Some(BackendError::new(error_codes::RAG_INDEX_ERROR, last_error)),
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
                    error: Some(BackendError::new(error_codes::RAG_FETCH_ERROR, e)),
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
            error: Some(BackendError::new(error_codes::RAG_SEARCH_ERROR, e)),
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
                error: Some(BackendError::new(error_codes::RAG_FETCH_ERROR, e)),
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
                        error: Some(BackendError::new(error_codes::RAG_FETCH_ERROR, e)),
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
            error: Some(BackendError::new(error_codes::RAG_FETCH_ERROR, e)),
        },
    }
}

pub async fn get_project_stats<'a>(req: GetProjectStatsRequest<'a>) -> ApiResponse<ProjectStats> {
    if let Err(e) = validate_project_id(&req.project_id) {
        return rag_validation_error(e);
    }
    let store = req.state.inner();
    let s = store.read().await;
    match s.get_project_stats(&req.project_id).await {
        Ok(stats) => ApiResponse {
            success: true,
            data: Some(stats),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(error_codes::RAG_STATS_ERROR, e)),
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
            error: Some(BackendError::new(error_codes::RAG_UPDATE_ERROR, e)),
        };
    }
    ApiResponse {
        success: true,
        data: Some(true),
        error: None,
    }
}

pub async fn validate_embedding_model(
    req: ValidateEmbeddingModelRequest,
) -> ApiResponse<RagModelValidation> {
    if !crate::validation::is_valid_model_name(&req.model_name) {
        return rag_validation_error(format!("Invalid model name: {:?}", req.model_name));
    }
    let ollama_url = match req.base_url {
        Some(url) => match crate::ollama_url::parse_ollama_base_url(&url) {
            Ok(u) => u.to_string(),
            Err(e) => return rag_validation_error(e),
        },
        None => "http://localhost:11434".to_string(),
    };
    let embedder = OllamaEmbedder::new(&ollama_url, &req.model_name);
    match embedder.validate().await {
        Ok(val) => ApiResponse {
            success: true,
            data: Some(val),
            error: None,
        },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new(error_codes::RAG_VALIDATION_ERROR, e)),
        },
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
                    error: Some(BackendError::new(error_codes::RAG_FETCH_ERROR, e)),
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
                error: Some(BackendError::new(error_codes::RAG_SEARCH_ERROR, e)),
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

// Re-export sub‑modules for external use
pub mod index;
pub mod model;
pub mod search;
pub mod stats;
