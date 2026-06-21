//! RAG domain services – thin wrappers that contain the business logic formerly
//! embedded in the Tauri command handlers. Commands should instantiate the service
//! locally and delegate to the async functions defined here.
//!
//! Currently the most complex command is `cmd_rag_index_project`, which orchestrates
//! rate‑limiting, abort‑handle management, request spawning, and event emission.
//! The heavy lifting of the actual indexing pipeline lives in `rag::indexing::index_project`.
//! This service moves the orchestration into a reusable module so the command can be a
//! thin adapter.

use std::sync::Arc;
use std::time::Instant;

use crate::payloads::{ApiResponse, BackendError};
use crate::rag::indexing;
use crate::rag::store::RagStore;
use crate::rate_limiter::RATE_LIMITER;
// use crate::tracing; // not needed
use crate::rag::validation::{rag_validation_error, validate_project_id};
use tauri::{Emitter, Runtime};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tracing::error;

/// Parameters required to start an indexing operation. This mirrors the arguments
/// accepted by the original `cmd_rag_index_project` Tauri command.
pub struct IndexRequest<'a, R: Runtime> {
    // The lifetime ties the State reference to the request lifetime.
    // This mirrors how Tauri provides State to command handlers.
    pub window: tauri::Window<R>,
    pub project_id: String,
    pub force: Option<bool>,
    pub base_url: Option<String>,
    pub state: tauri::State<'a, Arc<Mutex<RagStore>>>,
    pub app_handle: tauri::AppHandle,
}

/// Starts an RAG project indexing job.
///
/// The function performs:
/// 1. Rate‑limit check (using the global `RATE_LIMITER`).
/// 2. Validation of the `project_id`.
/// 3. Retrieval of the project from the store.
/// 4. Abort‑handle bookkeeping (`RAG_INDEX_ABORT_HANDLES`).
/// 5. Spawning of the async indexing task which calls `indexing::index_project`.
/// 6. Emission of success/failure events.
///
/// On success the command returns `ApiResponse<bool>` with `data = Some(true)`.
/// On any error a structured `BackendError` is returned inside the response.
pub async fn start_indexing<'a, R: Runtime>(
    req: IndexRequest<'a, R>,
) -> Result<ApiResponse<bool>, String> {
    // 1️⃣ Rate limiting – identical to previous command implementation.
    if let Err(e) = RATE_LIMITER.check_rate_limit(req.window.label(), "cmd_rag_index_project") {
        return Ok(ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        });
    }

    // 2️⃣ Validate project ID.
    if let Err(e) = validate_project_id(&req.project_id) {
        return Ok(rag_validation_error(e));
    }

    // 3️⃣ Load the project from the store.
    let store = (*req.state).clone();
    let project = {
        let s = store.lock().await;
        match s.get_project(&req.project_id).await {
            Ok(Some(p)) => p,
            Ok(None) => {
                return Ok(ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new("RAG_NOT_FOUND", "Project not found")),
                });
            }
            Err(e) => {
                return Ok(ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError::new("RAG_FETCH_ERROR", e)),
                });
            }
        }
    };

    // 4️⃣ Abort‑handle guard – ensure only one indexing task per project.
    if crate::shared::RAG_INDEX_ABORT_HANDLES.contains_key(&req.project_id) {
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
    crate::shared::RAG_INDEX_ABORT_HANDLES.insert(req.project_id.clone(), cancel_token.clone());

    // Prepare values for the async task (clone what is needed).
    let project_id_clone = req.project_id.clone();
    let project_path = project.path.clone();
    let embedding_model = project.embedding_model.clone();
    let ignore_patterns = project.ignore_patterns.clone();
    let force_val = req.force.unwrap_or(false);
    let base_url_val = match req.base_url {
        Some(url) => crate::ollama_url::parse_ollama_base_url(&url)
            .map_err(|e| e.to_string())?
            .to_string(),
        None => "http://localhost:11434".to_string(),
    };
    let store_clone = (*req.state).clone();
    let app_handle_for_index = req.app_handle.clone();
    let app_handle_for_callback = req.app_handle.clone();

    // 5️⃣ Spawn the indexing task.
    tauri::async_runtime::spawn(async move {
        let start = Instant::now();
        let result = indexing::index_project(
            store_clone.clone(),
            indexing::IndexOptions {
                project_id: &project_id_clone,
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

        // Cleanup abort handle regardless of outcome.
        crate::shared::RAG_INDEX_ABORT_HANDLES.remove(&project_id_clone);

        if let Err(e) = result {
            error!("Indexing failed for project {}: {}", project_id_clone, e);
            let error = crate::rag::types::IndexError {
                project_id: project_id_clone.clone(),
                message: e.clone(),
            };
            let _ = app_handle_for_callback.emit(crate::shared::EVENT_RAG_INDEX_ERROR, &error);
        } else {
            // Success – emit completion event with basic stats.
            let s = store_clone.lock().await;
            let stats = s.get_project_stats(&project_id_clone).await.ok();
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
        tracing::info!(
            "Indexing task finished for {} (duration: {:?})",
            project_id_clone,
            start.elapsed()
        );
    });

    // Immediate successful response – the actual work runs in the background.
    Ok(ApiResponse {
        success: true,
        data: Some(true),
        error: None,
    })
}
