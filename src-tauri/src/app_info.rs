//! Application metadata commands — thin adapters over Tauri's embedded
//! `package_info()`.
//!
//! The version string in `tauri.conf.json` is the single source of truth
//! for the installer/about UI. Tauri's `tauri::generate_context!()` macro
//! embeds `tauri.conf.json` at compile time and exposes it via
//! `AppHandle::package_info()`, so a dedicated command lets the frontend
//! read the canonical version without hardcoding.
//!
//! @see STANDARDS.md §6 — Commands MUST be thin adapters only.

use crate::payloads::ApiResponse;
use tauri::AppHandle;

/// Returns the application version string sourced from `tauri.conf.json`.
///
/// This is a read-only metadata command — no input validation is required
/// beyond the implicit Tauri state injection. The `AppHandle` parameter is
/// Tauri-injected and excluded from the IPC contract surface.
///
/// # Returns
/// `ApiResponse<String>` — the canonical version (e.g. `"0.1.1"`).
#[tauri::command]
pub async fn cmd_get_app_version(app: AppHandle) -> ApiResponse<String> {
    let version = app.package_info().version.to_string();
    tracing::debug!(version = %version, "cmd_get_app_version");
    ApiResponse {
        success: true,
        data: Some(version),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_shape_success() {
        let resp = ApiResponse {
            success: true,
            data: Some("0.1.1".to_string()),
            error: None,
        };
        assert!(resp.success);
        assert_eq!(resp.data.as_deref(), Some("0.1.1"));
        assert!(resp.error.is_none());
    }

    #[test]
    fn response_shape_error() {
        let resp: ApiResponse<String> = ApiResponse {
            success: false,
            data: None,
            error: Some(crate::payloads::BackendError::new(
                crate::error_codes::INTERNAL_ERROR,
                "unreachable in practice",
            )),
        };
        assert!(!resp.success);
        assert!(resp.data.is_none());
        assert!(resp.error.is_some());
    }
}
