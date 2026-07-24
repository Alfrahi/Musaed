//! Integration tests for Ollama IPC commands using mockito.

use musaed_lib::ollama::streaming::{process_chat_stream, TokenSink};
use musaed_lib::payloads::{
    ApiResponse, BackendError, ModelValidation, OllamaHealth, OllamaModel, OllamaToken,
};
use musaed_lib::shared::{clear_request_cache, test_cache_lock};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// Helper: returns the mockito server URL in a format that passes `ollama_url` validation.
fn mock_base_url(server: &mockito::ServerGuard) -> String {
    // mockito binds to 127.0.0.1 which is allowed by the URL validator
    server.url().trim_end_matches('/').to_string()
}

/// Test setup: acquire test cache lock and clear request cache.
/// Returns the guard which must be held for the entire test duration.
/// All Ollama integration tests must call this to prevent deadlocks.
async fn setup() -> tokio::sync::MutexGuard<'static, ()> {
    let guard = test_cache_lock().await;
    clear_request_cache();
    guard
}

// ==================== cmd_ollama_get_models ====================

#[tokio::test]
async fn get_models_success() {
    let _guard = setup().await;
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let body = serde_json::json!({
        "models": [
            {
                "name": "llama3:latest",
                "size": 4700000000_i64,
                "digest": "sha256:abc",
                "details": {
                    "format": "gguf",
                    "family": "llama",
                    "parameter_size": "8B",
                    "quantization_level": "Q4_0"
                }
            }
        ]
    });

    let mock = server
        .mock("GET", "/api/tags")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(body.to_string())
        .create_async()
        .await;

    let result: ApiResponse<Vec<OllamaModel>> =
        musaed_lib::ollama::cmd_ollama_get_models(url).await;

    mock.assert_async().await;
    assert!(result.success);
    let models = result.data.unwrap();
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].name, "llama3:latest");
}

#[tokio::test]
async fn get_models_empty_list() {
    let _guard = setup().await;
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let mock = server
        .mock("GET", "/api/tags")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"models": []}"#)
        .create_async()
        .await;

    let result: ApiResponse<Vec<OllamaModel>> =
        musaed_lib::ollama::cmd_ollama_get_models(url).await;

    mock.assert_async().await;
    assert!(result.success);
    assert_eq!(result.data.unwrap().len(), 0);
}

#[tokio::test]
async fn get_models_invalid_url() {
    let _guard = setup().await;
    let result: ApiResponse<Vec<OllamaModel>> =
        musaed_lib::ollama::cmd_ollama_get_models("http://8.8.8.8:11434".to_string()).await;

    assert!(!result.success);
    assert!(result.error.is_some());
    assert_eq!(result.error.unwrap().code, "INVALID_URL");
}

#[tokio::test]
async fn get_models_server_error() {
    let _guard = setup().await;
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let mock = server
        .mock("GET", "/api/tags")
        .with_status(500)
        .create_async()
        .await;

    // The command will try to parse the 500 response body as JSON.
    // reqwest doesn't treat 500 as an error, so it'll try to deserialize and fail.
    let result: ApiResponse<Vec<OllamaModel>> =
        musaed_lib::ollama::cmd_ollama_get_models(url).await;

    mock.assert_async().await;
    assert!(!result.success);
}

// ==================== cmd_ollama_validate_model ====================

#[tokio::test]
async fn cmd_ollama_validate_model_success() {
    let _guard = setup().await;
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let body = serde_json::json!({
        "details": {
            "format": "gguf",
            "family": "llama",
            "parameter_size": "8B",
            "quantization_level": "Q4_0"
        }
    });

    let mock = server
        .mock("POST", "/api/show")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(body.to_string())
        .create_async()
        .await;

    let result: ApiResponse<ModelValidation> =
        musaed_lib::ollama::cmd_ollama_validate_model(url, "llama3".to_string()).await;

    mock.assert_async().await;
    assert!(result.success);
    let validation = result.data.unwrap();
    assert!(validation.is_valid);
    assert_eq!(validation.model_name, "llama3");
    assert!(validation.details.is_some());
}

#[tokio::test]
async fn cmd_ollama_validate_model_not_found() {
    let _guard = setup().await;
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let mock = server
        .mock("POST", "/api/show")
        .with_status(404)
        .create_async()
        .await;

    let result: ApiResponse<ModelValidation> =
        musaed_lib::ollama::cmd_ollama_validate_model(url, "nonexistent".to_string()).await;

    mock.assert_async().await;
    assert!(!result.success);
    let validation = result.data.unwrap();
    assert!(!validation.is_valid);
}

// ==================== cmd_ollama_delete_model ====================

#[tokio::test]
async fn cmd_ollama_delete_model_success() {
    let _guard = setup().await;
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let mock = server
        .mock("DELETE", "/api/delete")
        .with_status(200)
        .create_async()
        .await;

    let result: ApiResponse<bool> =
        musaed_lib::ollama::cmd_ollama_delete_model(url, "llama3".to_string()).await;

    mock.assert_async().await;
    assert!(result.success);
    assert_eq!(result.data, Some(true));
}

#[tokio::test]
async fn cmd_ollama_delete_model_not_found() {
    let _guard = setup().await;
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let mock = server
        .mock("DELETE", "/api/delete")
        .with_status(404)
        .create_async()
        .await;

    let result: ApiResponse<bool> =
        musaed_lib::ollama::cmd_ollama_delete_model(url, "missing-model".to_string()).await;

    mock.assert_async().await;
    assert!(!result.success);
    assert_eq!(result.data, Some(false));
}

// ==================== cmd_ollama_verify_service ====================

#[tokio::test]
async fn verify_service_detects_ollama() {
    let _guard = setup().await;
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let mock = server
        .mock("GET", "/")
        .with_status(200)
        .with_header("server", "Ollama 0.5.6")
        .create_async()
        .await;

    let result: ApiResponse<String> = musaed_lib::ollama::cmd_ollama_verify_service(url).await;

    mock.assert_async().await;
    assert!(result.success);
    assert!(result.data.unwrap().contains("ollama"));
}

#[tokio::test]
async fn verify_service_rejects_non_ollama() {
    let _guard = setup().await;
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let mock = server
        .mock("GET", "/")
        .with_status(200)
        .with_header("server", "nginx")
        .create_async()
        .await;

    let result: ApiResponse<String> = musaed_lib::ollama::cmd_ollama_verify_service(url).await;

    mock.assert_async().await;
    assert!(!result.success);
    assert_eq!(result.error.unwrap().code, "NOT_OLLAMA");
}

// ==================== cmd_ollama_check_health ====================

#[tokio::test]
async fn health_check_healthy() {
    let _guard = setup().await;
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let mock = server
        .mock("GET", "/api/tags")
        .with_status(200)
        .with_header("server", "Ollama 0.5.6")
        .with_body(r#"{"models": []}"#)
        .create_async()
        .await;

    let result: ApiResponse<OllamaHealth> = musaed_lib::ollama::cmd_ollama_check_health(url).await;

    mock.assert_async().await;
    assert!(result.success);
    let health = result.data.unwrap();
    assert!(health.is_running);
    assert!(health.response_time_ms > 0);
}

#[tokio::test]
async fn health_check_connection_refused() {
    let _guard = setup().await;
    // Use a port that's not listening — will fail to connect.
    // We use a public IP to bypass the URL validator, but that won't work.
    // Instead, use localhost with a high random port.
    let url = "http://127.0.0.1:1".to_string();

    let result: ApiResponse<OllamaHealth> = musaed_lib::ollama::cmd_ollama_check_health(url).await;

    assert!(!result.success);
    let health = result.data.unwrap();
    assert!(!health.is_running);
}

// ==================== cmd_ollama_abort_chat ====================

#[tokio::test]
async fn cmd_ollama_abort_chat_nonexistent_returns_success() {
    let _guard = setup().await;
    let result: ApiResponse<()> =
        musaed_lib::ollama::cmd_ollama_abort_chat("nonexistent-request".to_string()).await;

    // cmd_ollama_abort_chat always returns success, even if no active chat was found
    assert!(result.success);
}

// ==================== cmd_ollama_abort_pull ====================

#[tokio::test]
async fn cmd_ollama_abort_pull_nonexistent_returns_success() {
    let _guard = setup().await;
    let result: ApiResponse<()> =
        musaed_lib::ollama::cmd_ollama_abort_pull("nonexistent-model".to_string()).await;

    assert!(result.success);
}

// ==================== Streaming integration tests ====================

/// A [`TokenSink`] that sends tokens and errors into MPSC channels so tests
/// can assert on emitted events without a Tauri runtime.
struct ChannelSink {
    token_tx: mpsc::UnboundedSender<OllamaToken>,
    error_tx: mpsc::UnboundedSender<BackendError>,
}

impl TokenSink for ChannelSink {
    fn emit_token(&self, token: &OllamaToken) {
        let _ = self.token_tx.send(token.clone());
    }

    fn emit_error(&self, error: &BackendError) {
        let _ = self.error_tx.send(error.clone());
    }
}

/// Builds a mock SSE response body from a list of JSON values.
/// Each value is serialized to a single NDJSON line terminated by `\n`,
/// matching Ollama's actual streaming format.
fn ndjson_body(tokens: &[serde_json::Value]) -> String {
    tokens
        .iter()
        .map(|v| serde_json::to_string(v).unwrap())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

/// Helper: creates a mockito server with a `/api/chat` endpoint that returns
/// the given NDJSON body, then sends a POST request to it and returns the
/// response for use with `process_chat_stream`.
async fn mock_chat_response(server: &mut mockito::ServerGuard, body: &str) -> reqwest::Response {
    let _mock = server
        .mock("POST", "/api/chat")
        .with_status(200)
        .with_header("content-type", "application/x-ndjson")
        .with_body(body)
        .create_async()
        .await;

    let url = format!("{}/api/chat", mock_base_url(server));
    reqwest::Client::new()
        .post(&url)
        .json(&serde_json::json!({
            "model": "llama3",
            "messages": [{"role": "user", "content": "hello"}],
            "stream": true
        }))
        .send()
        .await
        .expect("POST to mock /api/chat should succeed")
}

/// Helper: creates a mockito server with a `/api/chat` endpoint that streams
/// the response using chunked transfer encoding. The `chunks` vector contains
/// (chunk_body, delay_ms) pairs — each chunk is written followed by a sleep.
/// This simulates real SSE streaming where tokens arrive incrementally.
async fn mock_chat_response_chunked(
    server: &mut mockito::ServerGuard,
    chunks: Vec<(String, u64)>,
) -> reqwest::Response {
    let chunks = Arc::new(chunks);
    let _mock = server
        .mock("POST", "/api/chat")
        .with_status(200)
        .with_header("content-type", "application/x-ndjson")
        .with_chunked_body(move |w| {
            for (data, delay_ms) in chunks.iter() {
                w.write_all(data.as_bytes())?;
                w.flush()?;
                if *delay_ms > 0 {
                    std::thread::sleep(Duration::from_millis(*delay_ms));
                }
            }
            Ok(())
        })
        .create_async()
        .await;

    let url = format!("{}/api/chat", mock_base_url(server));
    reqwest::Client::new()
        .post(&url)
        .json(&serde_json::json!({
            "model": "llama3",
            "messages": [{"role": "user", "content": "hello"}],
            "stream": true
        }))
        .send()
        .await
        .expect("POST to mock /api/chat should succeed")
}

// ── streaming: normal token flow ────────────────────────────────

#[tokio::test]
async fn process_chat_stream_emits_tokens_in_order() {
    // No setup() — this test calls process_chat_stream directly and doesn't
    // touch REQUEST_CACHE, so it doesn't need the global cache lock. Holding
    // the lock here would serialize all cmd_* tests behind the chunked-body
    // delays used by other streaming tests.
    let mut server = mockito::Server::new_async().await;

    let tokens = vec![
        serde_json::json!({
            "model": "llama3",
            "createdAt": "2024-01-01T00:00:00Z",
            "message": {"role": "assistant", "content": "Hello"},
            "done": false
        }),
        serde_json::json!({
            "model": "llama3",
            "createdAt": "2024-01-01T00:00:01Z",
            "message": {"role": "assistant", "content": " world"},
            "done": false
        }),
        serde_json::json!({
            "model": "llama3",
            "createdAt": "2024-01-01T00:00:02Z",
            "message": {"role": "assistant", "content": ""},
            "done": true,
            "totalDuration": 1_000_000_000_u64,
            "evalCount": 2
        }),
    ];

    let body = ndjson_body(&tokens);
    let response = mock_chat_response(&mut server, &body).await;

    let (token_tx, mut token_rx) = mpsc::unbounded_channel();
    let (error_tx, mut error_rx) = mpsc::unbounded_channel();
    let sink = ChannelSink { token_tx, error_tx };
    let cancel_token = CancellationToken::new();
    let mut token_count: u64 = 0;

    process_chat_stream(
        &sink,
        "test-req-normal",
        response,
        &cancel_token,
        Duration::from_millis(500),
        &mut token_count,
    )
    .await;

    // Collect emitted tokens
    let mut emitted: Vec<OllamaToken> = vec![];
    while let Ok(t) = token_rx.try_recv() {
        emitted.push(t);
    }

    assert_eq!(emitted.len(), 3, "should emit all 3 tokens");
    assert_eq!(token_count, 3);
    assert!(!emitted[0].done);
    assert_eq!(emitted[0].message.as_ref().unwrap().content, "Hello");
    assert_eq!(emitted[1].message.as_ref().unwrap().content, " world");
    assert!(emitted[2].done);
    assert_eq!(emitted[2].eval_count, Some(2));

    // Each token should have the request_id injected
    for t in &emitted {
        assert_eq!(t.request_id, "test-req-normal");
    }

    // No errors should have been emitted
    assert!(error_rx.try_recv().is_err());
}

// ── streaming: cancellation mid-stream ──────────────────────────

#[tokio::test]
async fn process_chat_stream_cancellation_stops_early() {
    // No setup() — doesn't touch REQUEST_CACHE.
    let mut server = mockito::Server::new_async().await;

    // Build chunks: 5 tokens, each separated by a 50ms delay.
    // Cancellation fires after 120ms, so it should stop around token 2-3.
    let mut chunks: Vec<(String, u64)> = Vec::new();
    for i in 0..5 {
        let line = serde_json::json!({
            "model": "llama3",
            "message": {"role": "assistant", "content": format!("token{}", i)},
            "done": false
        });
        // 50ms delay *after* writing this chunk
        chunks.push((format!("{}\n", serde_json::to_string(&line).unwrap()), 50));
    }
    // Final done token (should not be reached)
    let done_line = serde_json::json!({
        "model": "llama3",
        "message": {"role": "assistant", "content": ""},
        "done": true
    });
    chunks.push((
        format!("{}\n", serde_json::to_string(&done_line).unwrap()),
        0,
    ));

    let response = mock_chat_response_chunked(&mut server, chunks).await;

    let (token_tx, mut token_rx) = mpsc::unbounded_channel();
    let (error_tx, mut _error_rx) = mpsc::unbounded_channel();
    let sink = ChannelSink { token_tx, error_tx };
    let cancel_token = CancellationToken::new();
    let mut token_count: u64 = 0;

    // Cancel after 120ms — should stop before all 6 tokens are consumed
    let cancel_clone = cancel_token.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(120)).await;
        cancel_clone.cancel();
    });

    process_chat_stream(
        &sink,
        "test-req-cancel",
        response,
        &cancel_token,
        Duration::from_secs(5),
        &mut token_count,
    )
    .await;

    let mut emitted: Vec<OllamaToken> = vec![];
    while let Ok(t) = token_rx.try_recv() {
        emitted.push(t);
    }

    // Should have stopped before consuming all 6 tokens
    assert!(
        emitted.len() < 6,
        "cancellation should stop stream before all tokens are consumed (got {})",
        emitted.len()
    );
    assert!(token_count < 6);
}

// ── streaming: idle timeout ─────────────────────────────────────

#[tokio::test]
async fn process_chat_stream_idle_timeout_emits_error() {
    // No setup() — doesn't touch REQUEST_CACHE.
    let mut server = mockito::Server::new_async().await;
    // With a 100ms idle timeout, the timeout should fire before the second
    // chunk arrives.
    let first = serde_json::json!({
        "model": "llama3",
        "message": {"role": "assistant", "content": "first"},
        "done": false
    });
    let second = serde_json::json!({
        "model": "llama3",
        "message": {"role": "assistant", "content": "should not arrive"},
        "done": true
    });
    let chunks: Vec<(String, u64)> = vec![
        (format!("{}\n", serde_json::to_string(&first).unwrap()), 300),
        (format!("{}\n", serde_json::to_string(&second).unwrap()), 0),
    ];

    let response = mock_chat_response_chunked(&mut server, chunks).await;

    let (token_tx, mut token_rx) = mpsc::unbounded_channel();
    let (error_tx, mut error_rx) = mpsc::unbounded_channel();
    let sink = ChannelSink { token_tx, error_tx };
    let cancel_token = CancellationToken::new();
    let mut token_count: u64 = 0;

    // Use a 100ms idle timeout — the 300ms delay after the first token will trigger it
    process_chat_stream(
        &sink,
        "test-req-idle",
        response,
        &cancel_token,
        Duration::from_millis(100),
        &mut token_count,
    )
    .await;

    // Should have received the first token
    let first = token_rx.try_recv().expect("first token should be emitted");
    assert_eq!(first.message.as_ref().unwrap().content, "first");
    assert_eq!(token_count, 1);

    // Should have received an idle timeout error
    let err = error_rx
        .try_recv()
        .expect("idle timeout error should be emitted");
    assert_eq!(err.code, "STREAM_IDLE_TIMEOUT");
    assert_eq!(err.request_id.as_deref(), Some("test-req-idle"));
}

// ── streaming: Ollama error line ────────────────────────────────

#[tokio::test]
async fn process_chat_stream_ollama_error_stops_and_emits() {
    // No setup() — doesn't touch REQUEST_CACHE.
    let mut server = mockito::Server::new_async().await;

    // First a normal token, then an error from Ollama
    let tokens = vec![
        serde_json::json!({
            "model": "llama3",
            "message": {"role": "assistant", "content": "before error"},
            "done": false
        }),
        serde_json::json!({
            "error": "model not found"
        }),
        // This token should NOT be consumed (stream stops on error)
        serde_json::json!({
            "model": "llama3",
            "message": {"role": "assistant", "content": "after error"},
            "done": false
        }),
    ];

    let body = ndjson_body(&tokens);
    let response = mock_chat_response(&mut server, &body).await;

    let (token_tx, mut token_rx) = mpsc::unbounded_channel();
    let (error_tx, mut error_rx) = mpsc::unbounded_channel();
    let sink = ChannelSink { token_tx, error_tx };
    let cancel_token = CancellationToken::new();
    let mut token_count: u64 = 0;

    process_chat_stream(
        &sink,
        "test-req-ollama-err",
        response,
        &cancel_token,
        Duration::from_millis(500),
        &mut token_count,
    )
    .await;

    // First token should be emitted
    let first = token_rx.try_recv().expect("first token should be emitted");
    assert_eq!(first.message.as_ref().unwrap().content, "before error");
    assert_eq!(token_count, 1);

    // Error should be emitted
    let err = error_rx.try_recv().expect("Ollama error should be emitted");
    assert_eq!(err.code, "OLLAMA_ERROR");
    assert_eq!(err.message, "model not found");
    assert_eq!(err.request_id.as_deref(), Some("test-req-ollama-err"));

    // Third token should NOT be emitted (stream stopped on error)
    assert!(token_rx.try_recv().is_err(), "no more tokens after error");
}

// ── streaming: ABORT_HANDLES cleanup ────────────────────────────

#[tokio::test]
async fn abort_handles_cleanup_after_stream_completes() {
    // No setup() — ABORT_HANDLES is a concurrent DashMap and this test
    // uses a unique request_id. Doesn't touch REQUEST_CACHE.
    let mut server = mockito::Server::new_async().await;

    let tokens = vec![serde_json::json!({
        "model": "llama3",
        "message": {"role": "assistant", "content": "done"},
        "done": true
    })];

    let body = ndjson_body(&tokens);
    let response = mock_chat_response(&mut server, &body).await;

    let (token_tx, mut _token_rx) = mpsc::unbounded_channel();
    let (error_tx, mut _error_rx) = mpsc::unbounded_channel();
    let sink = ChannelSink { token_tx, error_tx };
    let cancel_token = CancellationToken::new();
    let mut token_count: u64 = 0;

    // Register the cancel token in ABORT_HANDLES (as service::chat does)
    let request_id = "test-req-cleanup".to_string();
    musaed_lib::shared::ABORT_HANDLES.insert(request_id.clone(), Arc::new(cancel_token.clone()));

    // Verify it's registered
    assert!(
        musaed_lib::shared::ABORT_HANDLES.contains_key(&request_id),
        "ABORT_HANDLES should contain the request before streaming"
    );

    process_chat_stream(
        &sink,
        &request_id,
        response,
        &cancel_token,
        Duration::from_millis(500),
        &mut token_count,
    )
    .await;

    // After stream completes, simulate what service::chat does via scopeguard::defer!
    musaed_lib::shared::ABORT_HANDLES.remove(&request_id);

    assert!(
        !musaed_lib::shared::ABORT_HANDLES.contains_key(&request_id),
        "ABORT_HANDLES should be cleaned up after stream completes"
    );
}

// ── streaming: empty lines are skipped ──────────────────────────

#[tokio::test]
async fn process_chat_stream_skips_empty_lines() {
    // No setup() — doesn't touch REQUEST_CACHE.
    let mut server = mockito::Server::new_async().await;

    // NDJSON with blank lines interspersed
    let body = "\n\n{\"model\":\"llama3\",\"message\":{\"role\":\"assistant\",\"content\":\"only\"},\"done\":false}\n\n\n{\"model\":\"llama3\",\"message\":{\"role\":\"assistant\",\"content\":\"\"},\"done\":true}\n\n";
    let response = mock_chat_response(&mut server, body).await;

    let (token_tx, mut token_rx) = mpsc::unbounded_channel();
    let (error_tx, mut error_rx) = mpsc::unbounded_channel();
    let sink = ChannelSink { token_tx, error_tx };
    let cancel_token = CancellationToken::new();
    let mut token_count: u64 = 0;

    process_chat_stream(
        &sink,
        "test-req-empty-lines",
        response,
        &cancel_token,
        Duration::from_millis(500),
        &mut token_count,
    )
    .await;

    let mut emitted: Vec<OllamaToken> = vec![];
    while let Ok(t) = token_rx.try_recv() {
        emitted.push(t);
    }

    assert_eq!(
        emitted.len(),
        2,
        "blank lines should be skipped, not parsed"
    );
    assert_eq!(token_count, 2);
    assert!(error_rx.try_recv().is_err());
}
