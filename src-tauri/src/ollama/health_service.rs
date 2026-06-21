//! Domain service for Ollama health checks.
//! Contains the business logic previously embedded in the Tauri command.

use crate::ollama::service::OllamaChatService;
use crate::payloads::{ApiResponse, OllamaHealth};
use tracing;

/// Perform an Ollama health check and return an `ApiResponse<OllamaHealth>`.
///
/// This mirrors the original command behaviour: on success the full
/// health struct is returned; on error a fallback `OllamaHealth` with
/// `is_running: false` and a measured response time is returned.
pub async fn check_health(base_url: String) -> ApiResponse<OllamaHealth> {
    tracing::info!("Checking Ollama health: {}", base_url);
    let start = std::time::Instant::now();

    // Use the same service implementation that the command previously called.
    let service = OllamaChatService;
    match service.health_check(base_url).await {
        Ok(health) => ApiResponse {
            success: true,
            data: Some(health),
            error: None,
        },
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            ApiResponse {
                success: false,
                data: Some(OllamaHealth {
                    is_running: false,
                    version: None,
                    response_time_ms: elapsed,
                }),
                error: Some(e),
            }
        }
    }
}
