//! Streaming model-pull progress processor (NDJSON over HTTP).
//!
//! Extracted from `model_service.rs` to keep the service thin.

use crate::payloads::{PullProgress, PullStreamError};
use crate::shared::{EVENT_PULL_ERROR, EVENT_PULL_PROGRESS, PULL_PROGRESS_THROTTLE_MS};
use futures::StreamExt;
use serde_json::json;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::time;
use tokio_util::codec::{FramedRead, LinesCodec};
use tokio_util::sync::CancellationToken;

/// Process a streaming model pull response, emitting progress events.
///
/// Reads newline-delimited JSON from the response body, parses each line as
/// [`PullProgress`], and emits `EVENT_PULL_PROGRESS` events (throttled to
/// `PULL_PROGRESS_THROTTLE_MS`).  Handles cancellation, stream errors, and
/// error lines from the Ollama API.
///
/// This is the pull-stream analogue of [`process_chat_stream`] in
/// `super::streaming`.
pub(crate) async fn process_pull_stream<R: Runtime>(
    app: &AppHandle<R>,
    name: &str,
    response: reqwest::Response,
    cancel_token: &CancellationToken,
    pull_start: Instant,
) {
    let mut last_emit = Instant::now();

    let stream = response.bytes_stream();
    let mut lines = FramedRead::new(
        tokio_util::io::StreamReader::new(stream.map(|res| res.map_err(std::io::Error::other))),
        LinesCodec::new_with_max_length(1_048_576),
    );

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                tracing::info!("Pull cancelled for model: {}", name);
                let _ = app.emit(
                    EVENT_PULL_ERROR,
                    &PullStreamError {
                        name: name.to_string(),
                        error: "Pull cancelled".to_string(),
                        duration: pull_start.elapsed().as_secs(),
                    },
                );
                return;
            }
            next = time::timeout(Duration::from_secs(1), lines.next()) => {
                match next {
                    Ok(Some(Ok(line))) => {
                        if let Ok(mut progress_val) =
                            serde_json::from_str::<serde_json::Value>(&line)
                        {
                            if let Some(err) = progress_val.get("error") {
                                let msg = err
                                    .as_str()
                                    .map(str::to_owned)
                                    .unwrap_or_else(|| err.to_string());
                                tracing::error!("Pull stream error for {}: {}", name, msg);
                                let _ = app.emit(
                                    EVENT_PULL_ERROR,
                                    &PullStreamError {
                                        name: name.to_string(),
                                        error: msg,
                                        duration: pull_start.elapsed().as_secs(),
                                    },
                                );
                                return;
                            }

                            if let Some(obj) = progress_val.as_object_mut() {
                                obj.insert("name".to_string(), json!(name));
                            }

                            if let Ok(p) = serde_json::from_value::<PullProgress>(progress_val) {
                                if last_emit.elapsed().as_millis() as u64
                                    > PULL_PROGRESS_THROTTLE_MS
                                    || p.status.contains("success")
                                {
                                    let _ = app.emit(EVENT_PULL_PROGRESS, &p);
                                    last_emit = Instant::now();
                                }
                            }
                        }
                    }
                    Ok(Some(Err(e))) => {
                        tracing::error!("Stream read error: {}", e);
                        break;
                    }
                    Ok(None) => break,
                    Err(_) => {
                        // Timeout — continue loop to check for cancellation
                    }
                }
            }
        }
    }

    tracing::info!(
        "Model pull completed: {} (duration: {:?})",
        name,
        pull_start.elapsed()
    );
}
