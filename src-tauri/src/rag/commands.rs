//! RAG Tauri commands — all 13 IPC endpoints.
//!
//! Each command follows the existing pattern: validate inputs, acquire rate
//! limit permit, execute, return `Result<ApiResponse<T>, String>`.

use crate::payloads::{ApiResponse, BackendError};
use crate::rag::embedder::OllamaEmbedder;
use crate::rag::indexing;
use crate::rag::search::RagSearchEngine;
use crate::rag::store::RagStore;
use crate::rag::types::{
    ChunkRecord, IndexStatus, ModelValidation, ProjectStats, RagProject,
};
use crate::rag::validation;
use crate::shared::RAG_INDEX_ABORT_HANDLES;
use crate::validation::is_valid_model_name;
use serde::Deserialize;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

// ====================== COMMAND PAYLOADS ======================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddProjectArgs {
    pub name: String,
    pub path: String,
    pub embedding_model: String,
    pub ignore_patterns: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectArgs {
    pub project_id: String,
    pub name: Option<String>,
    pub ignore_patterns: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchArgs {
    pub project_id: String,
    pub query: String,
    pub top_k: Option<usize>,
    pub threshold: Option<f32>,
    pub base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexProjectArgs {
    pub project_id: String,
    pub force: Option<bool>,
    pub base_url: Option<String>,
}

// ====================== PROJECT MANAGEMENT COMMANDS ======================

#[tauri::command]
pub async fn rag_add_project(
    args: AddProjectArgs,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
    _app_handle: tauri::AppHandle,
) -> Result<ApiResponse<RagProject>, String> {
    if let Err(e) = validation::validate_add_project(
        &args.name,
        &args.path,
        &args.embedding_model,
        &args.ignore_patterns,
    ) {
        return Ok(validation::rag_validation_error(e));
    }

    let path = std::path::Path::new(&args.path);
    if !path.exists() || !path.is_dir() {
        return Ok(validation::rag_validation_error(format!(
            "Path does not exist or is not a directory: {}",
            args.path
        )));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let project = RagProject {
        id: id.clone(),
        name: args.name,
        path: args.path,
        embedding_model: args.embedding_model,
        ignore_patterns: args.ignore_patterns,
        created_at: now.clone(),
        updated_at: now,
        indexed_at: None,
        file_count: 0,
        chunk_count: 0,
        total_bytes: 0,
        status: crate::rag::types::ProjectStatus::Idle,
    };

    let store = state.inner();
    let s = store.lock().await;

    if let Err(e) = s.create_project(&project) {
        return Ok(ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_CREATE_ERROR", e)),
        });
    }

    Ok(ApiResponse {
        success: true,
        data: Some(project),
        error: None,
    })
}

#[tauri::command]
pub async fn rag_remove_project(
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
pub async fn rag_update_project(
    args: UpdateProjectArgs,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<RagProject>, String> {
    if let Err(e) = validation::validate_project_id(&args.project_id) {
        return Ok(validation::rag_validation_error(e));
    }

    let store = state.inner();
    let s = store.lock().await;

    if let Err(e) = s.update_project_metadata(
        &args.project_id,
        args.name.as_deref(),
        args.ignore_patterns.as_deref(),
    ) {
        return Ok(ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError::new("RAG_UPDATE_ERROR", e)),
        });
    }

    Ok(match s.get_project(&args.project_id) {
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
pub async fn rag_list_projects(
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
pub async fn rag_get_project(
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
pub async fn rag_index_project(
    args: IndexProjectArgs,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
    app_handle: tauri::AppHandle,
) -> Result<ApiResponse<bool>, String> {
    if let Err(e) = validation::validate_project_id(&args.project_id) {
        return Ok(validation::rag_validation_error(e));
    }

    let store = state.inner();

    let project = {
        let s = store.lock().await;
        match s.get_project(&args.project_id) {
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

    if RAG_INDEX_ABORT_HANDLES.contains_key(&args.project_id) {
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
    RAG_INDEX_ABORT_HANDLES.insert(args.project_id.clone(), cancel_token.clone());

    let project_id = args.project_id;
    let project_path = project.path.clone();
    let embedding_model = project.embedding_model.clone();
    let ignore_patterns = project.ignore_patterns.clone();
    let force = args.force.unwrap_or(false);
    let base_url = args
        .base_url
        .unwrap_or_else(|| "http://localhost:11434".to_string());

    let store_clone = store.clone();
    let app_handle_for_index = app_handle.clone();
    let app_handle_for_callback = app_handle.clone();
    let project_id_clone = project_id.clone();

    tauri::async_runtime::spawn(async move {
        let result = indexing::index_project(
            store_clone.clone(),
            &project_id,
            &project_path,
            &embedding_model,
            &base_url,
            &ignore_patterns,
            force,
            cancel_token,
            app_handle_for_index,
        )
        .await;

        RAG_INDEX_ABORT_HANDLES.remove(&project_id_clone);

        if let Err(e) = result {
            log::error!("Indexing failed for project {}: {}", project_id_clone, e);
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
            let _ = app_handle_for_callback.emit(crate::shared::EVENT_RAG_INDEX_COMPLETE, &complete);
        }
    });

    Ok(ApiResponse {
        success: true,
        data: Some(true),
        error: None,
    })
}

#[tauri::command]
pub async fn rag_abort_index(
    project_id: String,
) -> Result<ApiResponse<bool>, String> {
    if let Err(e) = validation::validate_project_id(&project_id) {
        return Ok(validation::rag_validation_error(e));
    }

    Ok(if let Some((_, token)) = RAG_INDEX_ABORT_HANDLES.remove(&project_id) {
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
    })
}

#[tauri::command]
pub async fn rag_reindex_project(
    project_id: String,
    base_url: Option<String>,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
    app_handle: tauri::AppHandle,
) -> Result<ApiResponse<bool>, String> {
    rag_index_project(
        IndexProjectArgs {
            project_id,
            force: Some(true),
            base_url,
        },
        state,
        app_handle,
    )
    .await
}

#[tauri::command]
pub async fn rag_get_index_status(
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
pub async fn rag_search(
    args: SearchArgs,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
    _app_handle: tauri::AppHandle,
) -> Result<ApiResponse<Vec<crate::rag::types::SearchResult>>, String> {
    if let Err(e) = validation::validate_search(
        &args.project_id,
        &args.query,
        args.top_k,
        args.threshold,
    ) {
        return Ok(validation::rag_validation_error(e));
    }

    let store = state.inner();

    let project = {
        let s = store.lock().await;
        match s.get_project(&args.project_id) {
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

    let base_url = args
        .base_url
        .unwrap_or_else(|| "http://localhost:11434".to_string());

    Ok(match RagSearchEngine::search(
        store.clone(),
        &args.project_id,
        &args.query,
        &base_url,
        &project.embedding_model,
        args.top_k,
        args.threshold,
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
    })
}

#[tauri::command]
pub async fn rag_get_file_chunks(
    project_id: String,
    file_path: String,
    state: tauri::State<'_, Arc<Mutex<RagStore>>>,
) -> Result<ApiResponse<Vec<ChunkRecord>>, String> {
    if let Err(e) = validation::validate_project_id(&project_id) {
        return Ok(validation::rag_validation_error(e));
    }
    if let Err(e) = validation::validate_file_path(&file_path) {
        return Ok(validation::rag_validation_error(e));
    }

    let store = state.inner();
    let s = store.lock().await;

    Ok(match s.get_file_by_path(&project_id, &file_path) {
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
    })
}

#[tauri::command]
pub async fn rag_get_project_stats(
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
pub async fn rag_set_embedding_model(
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
pub async fn rag_validate_embedding_model(
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
