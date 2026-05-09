//! Streaming logic for Ollama chat and model-pull SSE endpoints.
//!
//! Contains the `process_chat_stream` helper that reads newline-delimited JSON
//! from Ollama's chat endpoint and emits Tauri events for each token.

use crate::payloads::{BackendError, OllamaToken};
use futures::StreamExt;
use serde_json::json;
use std::time::Duration;
use tauri::{Emitter, Runtime};
use tokio::time;
use tokio_util::codec::{FramedRead, LinesCodec};
use tokio_util::sync::CancellationToken;
use tracing;

use super::client::{EVENT_OLLAMA_ERROR, EVENT_OLLAMA_TOKEN, STREAM_IDLE_TIMEOUT_SECS};

/// Processes the SSE stream from Ollama's chat endpoint, emitting tokens as Tauri events.
pub(crate) async fn process_chat_stream<R: Runtime>(
    app: &tauri::AppHandle<R>,
    request_id: &str,
    response: reqwest::Response,
    cancel_token: &CancellationToken,
    token_count: &mut u64,
) {
    let stream = response.bytes_stream();
    // Cap line length at 1 MiB to prevent unbounded memory allocation from
    // a malformed or malicious SSE stream (resource-exhaustion mitigation).
    let mut lines = FramedRead::new(
        tokio_util::io::StreamReader::new(stream.map(|res| res.map_err(std::io::Error::other))),
        LinesCodec::new_with_max_length(1_048_576),
    );

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                tracing::info!("Stream cancelled for request_id: {}", request_id);
                break;
            }
            next = time::timeout(Duration::from_secs(STREAM_IDLE_TIMEOUT_SECS), lines.next()) => {
                match next {
                    Ok(Some(Ok(line))) => {
                        if line.trim().is_empty() {
                            continue;
                        }

                        match serde_json::from_str::<serde_json::Value>(&line) {
                            Ok(mut token_data) => {
                                if let Some(err) = token_data.get("error") {
                                    let msg = err.as_str().map(str::to_owned).unwrap_or_else(|| err.to_string());
                                    let _ = app.emit(
                                        EVENT_OLLAMA_ERROR,
                                        &BackendError::new("OLLAMA_ERROR", msg)
                                            .with_request_id(request_id.to_string()),
                                    );
                                    break;
                                }

                                if let Some(obj) = token_data.as_object_mut() {
                                    obj.insert("requestId".to_string(), json!(request_id));
                                }

                                match serde_json::from_value::<OllamaToken>(token_data) {
                                    Ok(token) => {
                                        *token_count += 1;
                                        let _ = app.emit(EVENT_OLLAMA_TOKEN, &token);
                                    }
                                    Err(e) => tracing::warn!("Failed to parse token: {}", e),
                                }
                            }
                            Err(e) => tracing::warn!("Failed to parse JSON line: {}", e),
                        }
                    }
                    Ok(Some(Err(e))) => {
                        tracing::error!("Stream read error: {}", e);
                        break;
                    }
                    Ok(None) => break,
                    Err(_) => {
                        tracing::warn!("Idle timeout on stream for request_id: {}", request_id);
                        let _ = app.emit(
                            EVENT_OLLAMA_ERROR,
                            &BackendError::new("STREAM_IDLE_TIMEOUT", "No data received for too long")
                                .with_request_id(request_id.to_string()),
                        );
                        break;
                    }
                }
            }
        }
    }
}
