//! Streaming logic for Ollama chat and model-pull SSE endpoints.
//!
//! Contains the `process_chat_stream` helper that reads newline-delimited JSON
//! from Ollama's chat endpoint and emits tokens via a [`TokenSink`].
//!
//! `TokenSink` abstracts where emitted tokens/errors go so the streaming path
//! is integration-testable without a Tauri runtime. Production code constructs
//! a [`TauriEmitter`] (which forwards to `tauri::AppHandle::emit`); tests
//! construct a channel-backed sink and assert on the collected events.

use crate::error_codes;
use crate::payloads::{BackendError, OllamaToken};
use futures::StreamExt;
use serde_json::json;
use std::time::Duration;
use tauri::{Emitter, Runtime};
use tokio::time;
use tokio_util::codec::{FramedRead, LinesCodec};
use tokio_util::sync::CancellationToken;
use tracing;

use super::client::{EVENT_OLLAMA_ERROR, EVENT_OLLAMA_TOKEN};

/// Sink abstraction for the chat streaming path.
///
/// Each successful NDJSON line from Ollama becomes an [`emit_token`](Self::emit_token)
/// call; a stream-level error (e.g. idle timeout, Ollama `{"error": ...}` line)
/// becomes an [`emit_error`](Self::emit_error) call. Implementations are
/// responsible for delivering the event to the right consumer (Tauri frontend,
/// test channel, ...).
///
/// The trait is kept synchronous and fallible-but-swallowing to mirror the
/// existing production behavior, which uses `let _ = app.emit(...)` and never
/// propagates emit failures back into the stream loop.
pub trait TokenSink {
    fn emit_token(&self, token: &OllamaToken);
    fn emit_error(&self, error: &BackendError);
}

/// Production [`TokenSink`] that forwards tokens and errors to the Tauri
/// frontend via `AppHandle::emit`, using the same event names
/// (`EVENT_OLLAMA_TOKEN` / `EVENT_OLLAMA_ERROR`) the frontend listens for.
pub struct TauriEmitter<'a, R: Runtime> {
    app: &'a tauri::AppHandle<R>,
}

impl<'a, R: Runtime> TauriEmitter<'a, R> {
    pub fn new(app: &'a tauri::AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> TokenSink for TauriEmitter<'_, R> {
    fn emit_token(&self, token: &OllamaToken) {
        let _ = self.app.emit(EVENT_OLLAMA_TOKEN, token);
    }

    fn emit_error(&self, error: &BackendError) {
        let _ = self.app.emit(EVENT_OLLAMA_ERROR, error);
    }
}

/// Processes the SSE stream from Ollama's chat endpoint, emitting tokens via
/// the provided [`TokenSink`].
///
/// Loop semantics:
/// - Cancellation: returns as soon as `cancel_token` fires.
/// - Idle timeout: if no line arrives within `idle_timeout`, emits a
///   `STREAM_IDLE_TIMEOUT` error and returns. Production callers pass
///   [`STREAM_IDLE_TIMEOUT_SECS`](super::client::STREAM_IDLE_TIMEOUT_SECS);
///   passing it as a parameter keeps the function testable without depending
///   on a multi-minute constant.
/// - Stream end (`None`) / read error: returns.
/// - Ollama error line (`{"error": ...}`): emits the error and returns.
///
/// The absolute timeout (`STREAM_ABSOLUTE_TIMEOUT_SECS`) is **not** enforced
/// here; the caller wraps this future in `tokio::time::timeout` (see
/// `service::chat`) so the surrounding spawned task can run cleanup.
pub async fn process_chat_stream<S: TokenSink>(
    sink: &S,
    request_id: &str,
    response: reqwest::Response,
    cancel_token: &CancellationToken,
    idle_timeout: Duration,
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
            next = time::timeout(idle_timeout, lines.next()) => {
                match next {
                    Ok(Some(Ok(line))) => {
                        if line.trim().is_empty() {
                            continue;
                        }

                        match serde_json::from_str::<serde_json::Value>(&line) {
                            Ok(mut token_data) => {
                                if let Some(err) = token_data.get("error") {
                                    let msg = err.as_str().map(str::to_owned).unwrap_or_else(|| err.to_string());
                                    sink.emit_error(
                                        &BackendError::new(error_codes::OLLAMA_ERROR, msg)
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
                                        sink.emit_token(&token);
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
                        sink.emit_error(
                            &BackendError::new(error_codes::STREAM_IDLE_TIMEOUT, "No data received for too long")
                                .with_request_id(request_id.to_string()),
                        );
                        break;
                    }
                }
            }
        }
    }
}
