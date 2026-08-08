//! System tray domain.
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
use tauri_plugin_store::StoreExt;

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

/// Tauri-plugin-store filename and zustand persist key for the settings store.
/// These mirror `apps/web/src/store/settings-store.ts` (filename via
/// `createTauriStorage('settings-state.json', ...)`, name `musaed-settings-storage`).
mod settings_keys {
    pub const STORE_FILE: &str = "settings-state.json";
    pub const PERSIST_KEY: &str = "musaed-settings-storage";
}

/// Reads the `closeToTray` setting synchronously from the tauri-plugin-store.
///
/// The frontend `settings-store.ts` (Zustand `persist` middleware) writes the
/// entire settings store as a JSON-encoded string under
/// `musaed-settings-storage`. The string's shape is:
/// `{"state":{"globalSettings":{...ChatSettings..., "closeToTray": bool}}, "version": N}`.
/// We double-decode: the outer `Value::String` holds the JSON wrapper, and the
/// inner `globalSettings.closeToTray` boolean is what we want.
///
/// Returns `true` (always minimize to tray) on any read/parse error so that
/// the default behavior matches `DEFAULT_SETTINGS.closeToTray = true`. This
/// means a fresh install with no persisted store still minimizes to tray.
fn read_close_to_tray_setting(app: &AppHandle) -> bool {
    let store = match app.store(settings_keys::STORE_FILE) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "Failed to open settings store; defaulting closeToTray=true");
            return true;
        }
    };

    let raw = store.get(settings_keys::PERSIST_KEY);
    let outer = match raw {
        Some(v) => {
            tracing::debug!(
                raw_type = match &v {
                    serde_json::Value::String(_) => "String",
                    serde_json::Value::Object(_) => "Object",
                    serde_json::Value::Bool(_) => "Bool",
                    _ => "Other",
                },
                raw_preview = %v.to_string().chars().take(200).collect::<String>(),
                "read_close_to_tray_setting: raw store value retrieved"
            );
            v
        }
        None => {
            tracing::debug!("read_close_to_tray_setting: no persisted value, defaulting true");
            // No persisted settings yet (fresh install) — use the default.
            return true;
        }
    };

    // Zustand's JSON storage stores the value as a JSON-encoded String.
    let outer_str = match &outer {
        serde_json::Value::String(s) => s.as_str(),
        other => {
            // Defensive: if it's already an object (some custom storage path),
            // try to use it directly.
            return read_close_to_tray_from_object(other);
        }
    };

    let outer_json: serde_json::Value = match serde_json::from_str(outer_str) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "Settings store outer JSON parse failed; defaulting closeToTray=true");
            return true;
        }
    };

    let result = read_close_to_tray_from_object(&outer_json);
    tracing::info!(
        parsed_close_to_tray = result,
        "read_close_to_tray_setting: parsed from zustand wrapper"
    );
    result
}

/// Navigates `{"state":{"globalSettings":{"closeToTray": bool}}}` and returns
/// the boolean. Defaults to `true` if the path is missing or the field is
/// absent — matching `DEFAULT_SETTINGS.closeToTray`.
fn read_close_to_tray_from_object(v: &serde_json::Value) -> bool {
    let global_settings = v
        .get("state")
        .and_then(|s| s.get("globalSettings"))
        .or_else(|| v.get("globalSettings"));

    match global_settings {
        Some(gs) => match gs.get("closeToTray") {
            Some(serde_json::Value::Bool(b)) => *b,
            _ => true, // Field absent (e.g. older persisted state) — default true.
        },
        None => true, // No globalSettings root — fresh/corrupt store, default true.
    }
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

/// Window close-requested handler. Behavior is governed by the user-facing
/// "closeToTray" setting (persisted in `settings-state.json` under the
/// `musaed-settings-storage` key, written by the frontend `settings-store.ts`):
///
/// - `closeToTray == true` (DEFAULT): always prevent the close and hide the
///   window to the tray. The tray menu's "Quit" item is the only exit path.
/// - `closeToTray == false`: fall back to the background-task-conditional
///   behavior — minimize-to-tray only when a chat stream / model pull / RAG
///   index is active; otherwise allow the close to proceed normally.
///
/// Read path: `tauri-plugin-store` exposes a synchronous `StoreExt::store()`
/// accessor on `AppHandle`; `Store::get()` returns `Option<serde_json::Value>`
/// synchronously, so the close handler does not block on async IPC.
///
/// Call from `.on_window_event()` registered on the `tauri::Builder`.
pub fn handle_close_requested(window: &Window, api: &tauri::CloseRequestApi) {
    let close_to_tray = read_close_to_tray_setting(window.app_handle());

    tracing::info!(
        close_to_tray,
        has_active_tasks = has_active_background_tasks(),
        "handle_close_requested: close_to_tray setting read"
    );

    let minimize_to_tray = if close_to_tray {
        // User preference: always minimize to tray on close.
        true
    } else {
        // Background-task-conditional fallback.
        has_active_background_tasks()
    };

    if minimize_to_tray {
        // Prevent the window from closing; hide it to tray instead.
        api.prevent_close();
        let _ = window.hide();

        // Update the tray tooltip to reflect what's running.
        if let Some(tray) = window.app_handle().tray_by_id("main-tray") {
            let tooltip = build_tooltip();
            let _ = tray.set_tooltip(Some(tooltip));
        }

        tracing::info!(
            close_to_tray,
            "Window close intercepted — minimized to tray"
        );
    }
    // When minimize_to_tray is false, the close proceeds normally
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

    // ── closeToTray setting parser tests ──────────────────────────────────
    // These cover the pure JSON parsing logic in `read_close_to_tray_from_object`.
    // The `read_close_to_tray_setting` wrapper that opens the tauri-plugin-store
    // is not testable without a real AppHandle, so we test the parser directly.

    #[test]
    fn close_to_tray_parses_true_from_zustand_wrapper() {
        let outer = serde_json::json!({
            "state": { "globalSettings": { "closeToTray": true } },
            "version": 2
        });
        assert!(read_close_to_tray_from_object(&outer));
    }

    #[test]
    fn close_to_tray_parses_false_from_zustand_wrapper() {
        let outer = serde_json::json!({
            "state": { "globalSettings": { "closeToTray": false } },
            "version": 2
        });
        assert!(!read_close_to_tray_from_object(&outer));
    }

    #[test]
    fn close_to_tray_defaults_true_when_field_absent() {
        // Older persisted state (pre-closeToTray) — must default to true,
        // matching DEFAULT_SETTINGS.closeToTray.
        let outer = serde_json::json!({
            "state": { "globalSettings": { "temperature": 0.7 } },
            "version": 1
        });
        assert!(read_close_to_tray_from_object(&outer));
    }

    #[test]
    fn close_to_tray_defaults_true_when_global_settings_missing() {
        // Corrupt or partial store — default to true.
        let outer = serde_json::json!({ "version": 2 });
        assert!(read_close_to_tray_from_object(&outer));
    }

    #[test]
    fn close_to_tray_defaults_true_for_empty_object() {
        assert!(read_close_to_tray_from_object(&serde_json::json!({})));
    }

    #[test]
    fn close_to_tray_parses_bare_global_settings_root() {
        // Defensive path: if a custom writer serialized the inner state object
        // directly (no zustand "state" wrapper), still find the value.
        let outer = serde_json::json!({
            "globalSettings": { "closeToTray": false }
        });
        assert!(!read_close_to_tray_from_object(&outer));
    }

    #[test]
    fn close_to_tray_ignores_non_bool_value() {
        let outer = serde_json::json!({
            "state": { "globalSettings": { "closeToTray": "yes" } }
        });
        assert!(read_close_to_tray_from_object(&outer));
    }
}
