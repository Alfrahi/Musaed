//! Tauri commands for application logging and diagnostics.

use crate::logger::ChannelLogger;
use crate::payloads::ApiResponse;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

/// Strips newlines, carriage returns, and other C0 control characters to
/// prevent log injection (e.g. forging additional log lines via user input).
fn sanitize_log_entry(entry: &str) -> String {
    entry
        .chars()
        .filter(|c| !c.is_control() || *c == '\t')
        .collect()
}

/// Resolves the path to the application log file, creating directories if needed.
fn get_log_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let log_dir = data_dir.join("musaed").join("logs");
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    Ok(log_dir.join("musaed.log"))
}

/// Routes a frontend log entry through the async channel logger.
/// Entries are prefixed with `[FRONTEND]` to distinguish them from backend
/// log lines and make cross-origin injection obvious.
fn append_log_entry(entry: String) {
    let sanitized = sanitize_log_entry(&entry);
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{}] [FRONTEND] {}\n", timestamp, sanitized);
    ChannelLogger::log_direct(line);
}

#[tauri::command]
pub async fn append_to_log(entry: String) -> ApiResponse<()> {
    append_log_entry(entry);
    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}

#[tauri::command]
pub async fn clear_logs<R: Runtime>(app: AppHandle<R>) -> ApiResponse<()> {
    log::info!("Clearing logs");
    // Flush pending writes before truncating the file.
    ChannelLogger::global().flush();

    let _ = tokio::task::spawn_blocking(move || {
        match get_log_path(&app) {
            Ok(path) => {
                if path.exists() {
                    let _ = std::fs::write(&path, b"");
                }
            }
            Err(e) => log::error!("Failed to resolve log path: {}", e),
        }
    })
    .await;
    ApiResponse {
        success: true,
        data: Some(()),
        error: None,
    }
}
