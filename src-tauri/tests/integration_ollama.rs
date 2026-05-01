//! Integration tests for Ollama IPC commands using mockito.

use musaed_lib::payloads::{
    ApiResponse, ModelValidation, OllamaHealth, OllamaModel,
};

/// Helper: returns the mockito server URL in a format that passes `ollama_url` validation.
fn mock_base_url(server: &mockito::ServerGuard) -> String {
    // mockito binds to 127.0.0.1 which is allowed by the URL validator
    server.url().trim_end_matches('/').to_string()
}

// ==================== get_ollama_models ====================

#[tokio::test]
async fn get_models_success() {
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
        musaed_lib::ollama::get_ollama_models(url).await;

    mock.assert_async().await;
    assert!(result.success);
    let models = result.data.unwrap();
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].name, "llama3:latest");
}

#[tokio::test]
async fn get_models_empty_list() {
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
        musaed_lib::ollama::get_ollama_models(url).await;

    mock.assert_async().await;
    assert!(result.success);
    assert_eq!(result.data.unwrap().len(), 0);
}

#[tokio::test]
async fn get_models_invalid_url() {
    let result: ApiResponse<Vec<OllamaModel>> =
        musaed_lib::ollama::get_ollama_models("http://8.8.8.8:11434".to_string()).await;

    assert!(!result.success);
    assert!(result.error.is_some());
    assert_eq!(result.error.unwrap().code, "INVALID_URL");
}

#[tokio::test]
async fn get_models_server_error() {
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
        musaed_lib::ollama::get_ollama_models(url).await;

    mock.assert_async().await;
    assert!(!result.success);
}

// ==================== validate_model ====================

#[tokio::test]
async fn validate_model_success() {
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
        musaed_lib::ollama::validate_model(url, "llama3".to_string()).await;

    mock.assert_async().await;
    assert!(result.success);
    let validation = result.data.unwrap();
    assert!(validation.is_valid);
    assert_eq!(validation.model_name, "llama3");
    assert!(validation.details.is_some());
}

#[tokio::test]
async fn validate_model_not_found() {
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let mock = server
        .mock("POST", "/api/show")
        .with_status(404)
        .create_async()
        .await;

    let result: ApiResponse<ModelValidation> =
        musaed_lib::ollama::validate_model(url, "nonexistent".to_string()).await;

    mock.assert_async().await;
    assert!(!result.success);
    let validation = result.data.unwrap();
    assert!(!validation.is_valid);
}

// ==================== delete_model ====================

#[tokio::test]
async fn delete_model_success() {
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let mock = server
        .mock("DELETE", "/api/delete")
        .with_status(200)
        .create_async()
        .await;

    let result: ApiResponse<bool> =
        musaed_lib::ollama::delete_model(url, "llama3".to_string()).await;

    mock.assert_async().await;
    assert!(result.success);
    assert_eq!(result.data, Some(true));
}

#[tokio::test]
async fn delete_model_not_found() {
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let mock = server
        .mock("DELETE", "/api/delete")
        .with_status(404)
        .create_async()
        .await;

    let result: ApiResponse<bool> =
        musaed_lib::ollama::delete_model(url, "missing-model".to_string()).await;

    mock.assert_async().await;
    assert!(!result.success);
    assert_eq!(result.data, Some(false));
}

// ==================== verify_ollama_service ====================

#[tokio::test]
async fn verify_service_detects_ollama() {
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let mock = server
        .mock("GET", "/")
        .with_status(200)
        .with_header("server", "Ollama 0.5.6")
        .create_async()
        .await;

    let result: ApiResponse<String> =
        musaed_lib::ollama::verify_ollama_service(url).await;

    mock.assert_async().await;
    assert!(result.success);
    assert!(result.data.unwrap().contains("ollama"));
}

#[tokio::test]
async fn verify_service_rejects_non_ollama() {
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let mock = server
        .mock("GET", "/")
        .with_status(200)
        .with_header("server", "nginx")
        .create_async()
        .await;

    let result: ApiResponse<String> =
        musaed_lib::ollama::verify_ollama_service(url).await;

    mock.assert_async().await;
    assert!(!result.success);
    assert_eq!(result.error.unwrap().code, "NOT_OLLAMA");
}

// ==================== check_ollama_health ====================

#[tokio::test]
async fn health_check_healthy() {
    let mut server = mockito::Server::new_async().await;
    let url = mock_base_url(&server);

    let mock = server
        .mock("GET", "/api/tags")
        .with_status(200)
        .with_header("server", "Ollama 0.5.6")
        .with_body(r#"{"models": []}"#)
        .create_async()
        .await;

    let result: ApiResponse<OllamaHealth> =
        musaed_lib::ollama::check_ollama_health(url).await;

    mock.assert_async().await;
    assert!(result.success);
    let health = result.data.unwrap();
    assert!(health.is_running);
    assert!(health.response_time_ms > 0);
}

#[tokio::test]
async fn health_check_connection_refused() {
    // Use a port that's not listening — will fail to connect.
    // We use a public IP to bypass the URL validator, but that won't work.
    // Instead, use localhost with a high random port.
    let url = "http://127.0.0.1:1".to_string();

    let result: ApiResponse<OllamaHealth> =
        musaed_lib::ollama::check_ollama_health(url).await;

    assert!(!result.success);
    let health = result.data.unwrap();
    assert!(!health.is_running);
}

// ==================== abort_chat ====================

#[tokio::test]
async fn abort_chat_nonexistent_returns_success() {
    let result: ApiResponse<()> =
        musaed_lib::ollama::abort_chat("nonexistent-request".to_string()).await;

    // abort_chat always returns success, even if no active chat was found
    assert!(result.success);
}

// ==================== abort_pull ====================

#[tokio::test]
async fn abort_pull_nonexistent_returns_success() {
    let result: ApiResponse<()> =
        musaed_lib::ollama::abort_pull("nonexistent-model".to_string()).await;

    assert!(result.success);
}
