use tauri::{AppHandle, Emitter, Runtime};
use crate::payloads::{ApiResponse, BackendError, ChatMessage, ChatOptions, OllamaModel, OllamaToken, PullProgress};
use serde_json::json;
use std::sync::Arc;
use dashmap::DashMap;
use once_cell::sync::Lazy;
use futures::StreamExt;
use tokio_util::codec::{FramedRead, LinesCodec};
use tokio_util::sync::CancellationToken;

static ABORT_HANDLES: Lazy<DashMap<String, Arc<CancellationToken>>> = Lazy::new(DashMap::new);

#[tauri::command]
pub async fn get_ollama_models(base_url: String) -> ApiResponse<Vec<OllamaModel>> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));

    match client.get(&url).send().await {
        Ok(resp) => {
            match resp.json::<serde_json::Value>().await {
                Ok(json) => {
                    let models: Vec<OllamaModel> = serde_json::from_value(
                        json.get("models").cloned().unwrap_or_else(|| json!([]))
                    ).unwrap_or_default();

                    ApiResponse { success: true, data: Some(models), error: None }
                }
                Err(e) => ApiResponse {
                    success: false,
                    data: None,
                    error: Some(BackendError { code: "INVALID_RESPONSE".into(), message: e.to_string(), request_id: None }),
                },
            }
        }
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError { code: "NETWORK_ERROR".into(), message: e.to_string(), request_id: None }),
        },
    }
}

#[tauri::command]
pub async fn chat_with_ollama<R: Runtime>(
    app: AppHandle<R>,
    base_url: String,
    model: String,
    messages: Vec<ChatMessage>,
    options: ChatOptions,
    request_id: String,
) -> ApiResponse<bool> {
    let cancel_token = Arc::new(CancellationToken::new());
    ABORT_HANDLES.insert(request_id.clone(), cancel_token.clone());

    let client = reqwest::Client::new();
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));

    let payload = json!({ "model": model, "messages": messages, "options": options, "stream": true });

    // 1. Initial request to verify connection
    let response = match client.post(&url).json(&payload).send().await {
        Ok(resp) => resp,
        Err(e) => {
            ABORT_HANDLES.remove(&request_id);
            return ApiResponse {
                success: false,
                data: None,
                error: Some(BackendError { code: "REQUEST_ERROR".into(), message: e.to_string(), request_id: Some(request_id) }),
            };
        }
    };

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        ABORT_HANDLES.remove(&request_id);
        return ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError { code: "OLLAMA_ERROR".into(), message: error_text, request_id: Some(request_id) }),
        };
    }

    let request_id_clone = request_id.clone();
    let app_clone = app.clone();

    // 2. Spawn background task for NDJSON streaming
    tokio::spawn(async move {
        let stream = response.bytes_stream();
        let mut lines = FramedRead::new(
            tokio_util::io::StreamReader::new(stream.map(|res| res.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)))),
                                        LinesCodec::new()
        );

        while let Some(Ok(line)) = lines.next().await {
            if cancel_token.is_cancelled() { break; }
            if line.trim().is_empty() { continue; }

            if let Ok(mut token_data) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(obj) = token_data.as_object_mut() {
                    obj.insert("requestId".to_string(), json!(request_id_clone));
                }

                if let Ok(token) = serde_json::from_value::<OllamaToken>(token_data) {
                    let _ = app_clone.emit("ollama-token", token);
                }
            }
        }
        ABORT_HANDLES.remove(&request_id_clone);
    });

    ApiResponse { success: true, data: Some(true), error: None }
}

#[tauri::command]
pub async fn abort_chat(request_id: String) -> ApiResponse<()> {
    if let Some((_, token)) = ABORT_HANDLES.remove(&request_id) {
        token.cancel();
    }
    ApiResponse { success: true, data: Some(()), error: None }
}

#[tauri::command]
pub async fn pull_model<R: Runtime>(
    app: AppHandle<R>,
    base_url: String,
    name: String,
) -> ApiResponse<()> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/pull", base_url.trim_end_matches('/'));
    let app_clone = app.clone();
    let name_clone = name.clone();

    tokio::spawn(async move {
        match client.post(&url).json(&json!({ "name": name_clone, "stream": true })).send().await {
            Ok(response) => {
                let stream = response.bytes_stream();
                let mut lines = FramedRead::new(
                    tokio_util::io::StreamReader::new(stream.map(|res| res.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)))),
                                                LinesCodec::new()
                );

                while let Some(Ok(line)) = lines.next().await {
                    if let Ok(mut progress_val) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(obj) = progress_val.as_object_mut() {
                            obj.insert("name".to_string(), json!(name_clone));
                        }
                        if let Ok(p) = serde_json::from_value::<PullProgress>(progress_val) {
                            let _ = app_clone.emit("pull-progress", p);
                        }
                    }
                }
            }
            Err(e) => {
                let _ = app_clone.emit("pull-error", json!({ "name": name_clone, "error": e.to_string() }));
            }
        }
    });

    ApiResponse { success: true, data: Some(()), error: None }
}

#[tauri::command]
pub async fn delete_model(base_url: String, name: String) -> ApiResponse<bool> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/delete", base_url.trim_end_matches('/'));

    match client.delete(&url).json(&json!({ "name": name })).send().await {
        Ok(_) => ApiResponse { success: true, data: Some(true), error: None },
        Err(e) => ApiResponse {
            success: false,
            data: None,
            error: Some(BackendError { code: "DELETE_ERROR".into(), message: e.to_string(), request_id: None }),
        },
    }
}

// Stubs for other commands...
#[tauri::command] pub async fn append_to_log(_entry: String) -> ApiResponse<()> { ApiResponse { success: true, data: Some(()), error: None } }
#[tauri::command] pub async fn clear_logs() -> ApiResponse<()> { ApiResponse { success: true, data: Some(()), error: None } }
#[tauri::command] pub async fn select_and_extract_files() -> ApiResponse<Vec<String>> { ApiResponse { success: true, data: Some(vec![]), error: None } }
#[tauri::command] pub async fn select_and_extract_folder() -> ApiResponse<Vec<String>> { ApiResponse { success: true, data: Some(vec![]), error: None } }
