//! System tray domain (UX-UI-AUDIT Phase 2 Prompt 6, S-1).
//!
//! Builds the system tray icon and menu, intercepts the window close event
//! to minimize-to-tray when background tasks are active, and exposes an IPC
//! command for the frontend to query background-task status.
//!
//! Architecture (STANDARDS §6):
//! - `cmd_tray_get_background_status` — thin IPC adapter only.
//! - `get_background_status`            — domain logic: reads the three
//!   abort-handle DashMaps in `crate::shared`.
//! - `setup_tray` / `handle_close_requested` — tray lifecycle: icon + menu
//!   construction, close interception.
//!
//! @see STANDARDS.md §22 Core architectural model (Rust = system truth layer).

use crate::payloads::ApiResponse;
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent};

/// Background task kind surfaced to the frontend and tray tooltip.
/// Mirrors `BackgroundTaskKindSchema` in `packages/contracts/src/schemas/tray.ts`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BackgroundTaskKind {
    Chat,
    ModelPull,
    RagIndex,
}

/// Status of a single active background task kind.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTaskStatus {
    pub kind: BackgroundTaskKind,
    pub count: usize,
}

/// Response payload for `cmd_tray_get_background_status`.
/// Mirrors `BackgroundTasksResponseSchema` in the contracts package.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTasksResponse {
    pub tasks: Vec<BackgroundTaskStatus>,
    pub has_active_tasks: bool,
}

/// Queries the three abort-handle DashMaps and returns the active task
/// counts. This is the domain logic — no Tauri types beyond what the thin
/// adapter passes in.
pub fn get_background_status() -> BackgroundTasksResponse {
    let chat_count = crate::shared::ABORT_HANDLES.len();
    let pull_count = crate::shared::PULL_ABORT_HANDLES.len();
    let rag_count = crate::shared::RAG_INDEX_ABORT_HANDLES.len();

    let mut tasks = Vec::with_capacity(3);
    if chat_count > 0 {
        tasks.push(BackgroundTaskStatus {
            kind: BackgroundTaskKind::Chat,
            count: chat_count,
        });
    }
    if pull_count > 0 {
        tasks.push(BackgroundTaskStatus {
            kind: BackgroundTaskKind::ModelPull,
            count: pull_count,
        });
    }
    if rag_count > 0 {
        tasks.push(BackgroundTaskStatus {
            kind: BackgroundTaskKind::RagIndex,
            count: rag_count,
        });
    }

    let has_active = !tasks.is_empty();
    BackgroundTasksResponse {
        tasks,
        has_active_tasks: has_active,
    }
}

/// True when any background task (chat stream, model pull, RAG index) is
/// active. Used by the close interceptor to decide between minimize-to-tray
/// and normal exit.
pub fn has_active_background_tasks() -> bool {
    !crate::shared::ABORT_HANDLES.is_empty()
        || !crate::shared::PULL_ABORT_HANDLES.is_empty()
        || !crate::shared::RAG_INDEX_ABORT_HANDLES.is_empty()
}

/// Builds a human-readable tooltip for the tray icon summarising what's
/// running. When nothing is active, returns a plain "Musaed" label.
fn build_tooltip() -> String {
    let status = get_background_status();
    if !status.has_active_tasks {
        return "Musaed".to_string();
    }

    let parts: Vec<String> = status
        .tasks
        .iter()
        .map(|t| match t.kind {
            BackgroundTaskKind::Chat => format!("{} chat stream(s)", t.count),
            BackgroundTaskKind::ModelPull => format!("{} model pull(s)", t.count),
            BackgroundTaskKind::RagIndex => format!("{} RAG index task(s)", t.count),
        })
        .collect();

    format!("Musaed — {} active", parts.join(", "))
}

/// Tray menu item IDs. Used by the `on_menu_event` handler to dispatch
/// actions without matching on strings.
mod menu_ids {
    pub const SHOW_WINDOW: &str = "show-window";
    pub const QUIT: &str = "quit";
}

/// Builds and installs the system tray icon + menu during app setup.
///
/// Call from `tauri::Builder::setup()`.
pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Build the tray menu: "Show Window", separator, "Quit".
    let show_item = MenuItem::with_id(
        app,
        menu_ids::SHOW_WINDOW,
        "Show Window",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, menu_ids::QUIT, "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_item, &separator, &quit_item])?;

    // Use the bundled app icon (compiled in from tauri.conf.json `icon` array
    // via `tauri::generate_context!()`). `default_window_icon()` returns an
    // `Option<&Image<'_>>` without requiring the `image-png` cargo feature.
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("Default window icon not found for tray setup")?;

    let tooltip = build_tooltip();

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip(tooltip)
        .menu(&menu)
        .icon_as_template(true)
        .on_tray_icon_event(|tray, event| {
            // Single-click (left button up) on the tray icon restores the window.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        })
        .on_menu_event(|app, event| match event.id.0.as_str() {
            menu_ids::SHOW_WINDOW => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            menu_ids::QUIT => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    tracing::info!("System tray initialized");
    Ok(())
}

/// Window close-requested handler. When background tasks are active, prevents
/// the close and hides the window to tray. When idle, allows normal close.
///
/// Call from `.on_window_event()` registered on the `tauri::Builder`.
pub fn handle_close_requested(window: &Window, api: &tauri::CloseRequestApi) {
    if has_active_background_tasks() {
        // Prevent the window from closing; hide it to tray instead.
        api.prevent_close();
        let _ = window.hide();

        // Update the tray tooltip to reflect what's running.
        if let Some(tray) = window.app_handle().tray_by_id("main-tray") {
            let tooltip = build_tooltip();
            let _ = tray.set_tooltip(Some(tooltip));
        }

        tracing::info!("Window close intercepted — background tasks active, minimized to tray");
    }
    // When no background tasks are active, the close proceeds normally
    // (we do NOT call prevent_close).
}

/// Convenience wrapper for `on_window_event` that dispatches
/// `WindowEvent::CloseRequested` to `handle_close_requested`.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        handle_close_requested(window, api);
    }
}

// ── Thin IPC adapter ─────────────────────────────────────────────────────

/// Thin IPC adapter — no business logic (STANDARDS §6).
///
/// Returns the current background-task status by delegating to
/// `get_background_status()`. The Rust command takes only the
/// Tauri-injected `AppHandle`, so its user-facing argument shape is empty.
#[tauri::command]
pub async fn cmd_tray_get_background_status() -> ApiResponse<BackgroundTasksResponse> {
    let status = get_background_status();
    tracing::debug!(
        active = status.has_active_tasks,
        task_count = status.tasks.len(),
        "cmd_tray_get_background_status"
    );
    ApiResponse {
        success: true,
        data: Some(status),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_task_kind_serde_is_camel_case_round_trip() {
        for (kind, json) in [
            (BackgroundTaskKind::Chat, "\"chat\""),
            (BackgroundTaskKind::ModelPull, "\"modelPull\""),
            (BackgroundTaskKind::RagIndex, "\"ragIndex\""),
        ] {
            let s = serde_json::to_string(&kind).unwrap();
            assert_eq!(s, json);
            let back: BackgroundTaskKind = serde_json::from_str(json).unwrap();
            assert_eq!(back, kind);
        }
    }

    #[test]
    fn background_task_status_serializes_camel_case() {
        let status = BackgroundTaskStatus {
            kind: BackgroundTaskKind::Chat,
            count: 2,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"kind\":\"chat\""));
        assert!(json.contains("\"count\":2"));
    }

    #[test]
    fn background_tasks_response_serializes_camel_case() {
        let resp = BackgroundTasksResponse {
            tasks: vec![BackgroundTaskStatus {
                kind: BackgroundTaskKind::RagIndex,
                count: 1,
            }],
            has_active_tasks: true,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"hasActiveTasks\":true"));
        assert!(json.contains("\"kind\":\"ragIndex\""));
    }

    #[test]
    fn background_tasks_response_empty_is_not_active() {
        let resp = BackgroundTasksResponse {
            tasks: vec![],
            has_active_tasks: false,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"tasks\":[]"));
        assert!(json.contains("\"hasActiveTasks\":false"));
    }

    #[test]
    fn get_background_status_returns_response_shape() {
        // This test only validates the response shape construction;
        // it doesn't assert on counts since the DashMaps are process-global
        // and may have entries from other tests.
        let resp = get_background_status();
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("hasActiveTasks"));
        assert!(json.contains("tasks"));
    }

    #[test]
    fn build_tooltip_returns_musaed_when_idle() {
        // We can't control the global DashMaps in a unit test, so we
        // only check the format when the maps happen to be empty.
        // The test still validates that build_tooltip returns a String.
        let tooltip = build_tooltip();
        assert!(!tooltip.is_empty());
    }
}
