//! Tauri command adapters for the filesystem domain (`cmd_fs_*`).
//!
//! Thin adapters only (STANDARDS §6): rate limiting and argument plumbing
//! live here; grant checks, canonicalization, and I/O live in
//! [`super::service`].

use super::service::{
    read_file_base64_impl, read_text_file_impl, write_text_file_impl, FsAccessGrants,
};
use crate::payloads::ApiResponse;
use tauri::State;

/// Reads a text file from a user-granted location and returns its contents
/// as a string.
#[tauri::command]
pub async fn cmd_fs_read_text_file(
    window: tauri::WebviewWindow,
    grants: State<'_, FsAccessGrants>,
    path: String,
) -> Result<ApiResponse<String>, String> {
    if let Err(e) = crate::rate_limiter::check(window.label(), "cmd_fs_read_text_file") {
        return Ok(ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        });
    }
    Ok(read_text_file_impl(grants.inner(), &path))
}

/// Reads a binary file from a user-granted location and returns its contents
/// base64-encoded.
#[tauri::command]
pub async fn cmd_fs_read_file(
    window: tauri::WebviewWindow,
    grants: State<'_, FsAccessGrants>,
    path: String,
) -> Result<ApiResponse<String>, String> {
    if let Err(e) = crate::rate_limiter::check(window.label(), "cmd_fs_read_file") {
        return Ok(ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        });
    }
    Ok(read_file_base64_impl(grants.inner(), &path))
}

/// Writes text content to a file inside a user-granted location.
#[tauri::command]
pub async fn cmd_fs_write_text_file(
    window: tauri::Window,
    grants: State<'_, FsAccessGrants>,
    path: String,
    content: String,
) -> Result<ApiResponse<bool>, String> {
    if let Err(e) = crate::rate_limiter::check(window.label(), "cmd_fs_write_text_file") {
        return Ok(ApiResponse {
            success: false,
            data: None,
            error: Some(e),
        });
    }
    Ok(write_text_file_impl(grants.inner(), &path, content))
}
