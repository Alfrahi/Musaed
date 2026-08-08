//! Native macOS menu bar domain.
//!
//! Builds the native macOS app menu bar with standard App, Edit, View, and
//! Window submenus using Tauri 2's `tauri::menu` core API. On Windows and
//! Linux the module compiles to a no-op so the menu bar is macOS-only as
//! required.
//!
//! Architecture (STANDARDS §6):
//! - `cmd_menu_rebuild` — thin IPC adapter only, delegates to
//!   `rebuild_menu_bar`.
//! - `setup_menu_bar` / `rebuild_menu_bar` — menu lifecycle: construction
//!   from translated labels, installation via `app.set_menu()`, event
//!   dispatch via `app.on_menu_event`.
//! - `MenuBarLabels` — serialisable label struct mirroring the TS contract
//!   `MenuBarLabelsSchema` in `packages/contracts/src/schemas/menu-bar.ts`.
//!
//! i18n: the menu bar is built once at `.setup()` time using English defaults
//! (matching the tray precedent). The frontend calls `cmd_menu_rebuild` with
//! translated labels after locale load/change so the menu bar honours the
//! user's language preference (STANDARDS §11).
//!
//! @see STANDARDS.md §22 Core architectural model (Rust = system truth layer).

use crate::payloads::ApiResponse;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};

use crate::payloads::BackendError;

#[cfg(target_os = "macos")]
use crate::error_codes;

/// Tauri event emitted when a menu item action needs to be handled by the
/// frontend (e.g. "Zoom In" triggers a CSS zoom). The payload is the menu
/// item id string (see `menu_ids` constants). Re-exported from
/// `crate::shared::EVENT_MENU_ACTION` to keep one source of truth.
pub use crate::shared::EVENT_MENU_ACTION;

/// Menu item IDs. Used by the `on_menu_event` handler to dispatch actions
/// without matching on display labels.
pub mod menu_ids {
    // App menu
    pub const ABOUT: &str = "menu-about";
    pub const QUIT: &str = "menu-quit";

    // Edit menu — all predefined (OS-localized), no custom IDs needed.

    // View menu
    pub const TOGGLE_FULL_SCREEN: &str = "menu-toggle-fullscreen";
    pub const ZOOM_IN: &str = "menu-zoom-in";
    pub const ZOOM_OUT: &str = "menu-zoom-out";
    pub const ACTUAL_SIZE: &str = "menu-actual-size";

    // Window menu — predefined items, no custom IDs needed.
}

/// Translated labels shipped from the frontend (STANDARDS §11: backend has no
/// notion of locale for menu labels; the frontend translates and sends the
/// strings). Mirrors `MenuBarLabelsSchema` in the contracts package.
///
/// Only the custom (non-predefined) menu items need labels — `PredefinedMenuItem`
/// variants get OS-localized labels for free from the platform.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuBarLabels {
    /// App menu — "About Musaed"
    pub about: String,
    /// App menu — "Quit Musaed"
    pub quit: String,
    /// View menu — "Toggle Full Screen"
    pub toggle_full_screen: String,
    /// View menu — "Zoom In"
    pub zoom_in: String,
    /// View menu — "Zoom Out"
    pub zoom_out: String,
    /// View menu — "Actual Size"
    pub actual_size: String,
}

/// English fallback labels used at initial setup (before the frontend has
/// had a chance to call `cmd_menu_rebuild` with translated labels). Matches
/// the precedent in `tray.rs` which also hardcodes English at setup time.
#[cfg(target_os = "macos")]
fn default_labels() -> MenuBarLabels {
    MenuBarLabels {
        about: "About Musaed".to_string(),
        quit: "Quit Musaed".to_string(),
        toggle_full_screen: "Toggle Full Screen".to_string(),
        zoom_in: "Zoom In".to_string(),
        zoom_out: "Zoom Out".to_string(),
        actual_size: "Actual Size".to_string(),
    }
}

/// Builds the macOS app menu bar from the given labels and installs it as
/// the application menu via `app.set_menu()`. Also registers the global
/// `on_menu_event` handler that dispatches actions.
///
/// Call from `setup_menu_bar` (initial) or `rebuild_menu_bar` (locale change).
#[cfg(target_os = "macos")]
fn build_and_install(
    app: &AppHandle,
    labels: &MenuBarLabels,
) -> Result<(), Box<dyn std::error::Error>> {
    // ── App menu ─────────────────────────────────────────────────────────
    let about_item = MenuItem::with_id(app, menu_ids::ABOUT, &labels.about, true, None::<&str>)?;
    let app_separator_1 = PredefinedMenuItem::separator(app)?;
    // Services submenu is predefined on macOS — gets OS-localized label.
    let services = PredefinedMenuItem::services(app)?;
    let app_separator_2 = PredefinedMenuItem::separator(app)?;
    // Hide / Hide Others / Show All — all predefined.
    let hide = PredefinedMenuItem::hide(app)?;
    let hide_others = PredefinedMenuItem::hide_others(app)?;
    let show_all = PredefinedMenuItem::show_all(app)?;
    let app_separator_3 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, menu_ids::QUIT, &labels.quit, true, Some("Cmd+Q"))?;

    let app_menu = Submenu::with_items(
        app,
        "Musaed",
        true,
        &[
            &about_item,
            &app_separator_1,
            &services,
            &app_separator_2,
            &hide,
            &hide_others,
            &show_all,
            &app_separator_3,
            &quit_item,
        ],
    )?;

    // ── Edit menu ────────────────────────────────────────────────────────
    // All predefined items — OS-localized labels for free.
    let undo = PredefinedMenuItem::undo(app)?;
    let redo = PredefinedMenuItem::redo(app)?;
    let edit_sep_1 = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app)?;
    let copy = PredefinedMenuItem::copy(app)?;
    let paste = PredefinedMenuItem::paste(app)?;
    let select_all = PredefinedMenuItem::select_all(app)?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[&undo, &redo, &edit_sep_1, &cut, &copy, &paste, &select_all],
    )?;

    // ── View menu ───────────────────────────────────────────────────────
    // Toggle Full Screen + Zoom controls are custom items because they
    // trigger frontend CSS-zoom actions (emitted via `menu-action` event).
    let toggle_fullscreen = MenuItem::with_id(
        app,
        menu_ids::TOGGLE_FULL_SCREEN,
        &labels.toggle_full_screen,
        true,
        None::<&str>,
    )?;
    let view_sep_1 = PredefinedMenuItem::separator(app)?;
    let zoom_in = MenuItem::with_id(
        app,
        menu_ids::ZOOM_IN,
        &labels.zoom_in,
        true,
        Some("Cmd+Plus"),
    )?;
    let zoom_out = MenuItem::with_id(
        app,
        menu_ids::ZOOM_OUT,
        &labels.zoom_out,
        true,
        Some("Cmd+Minus"),
    )?;
    let actual_size = MenuItem::with_id(
        app,
        menu_ids::ACTUAL_SIZE,
        &labels.actual_size,
        true,
        Some("Cmd+Zero"),
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &toggle_fullscreen,
            &view_sep_1,
            &zoom_in,
            &zoom_out,
            &actual_size,
        ],
    )?;

    // ── Window menu ─────────────────────────────────────────────────────
    // Minimize + Zoom + Bring All to Front — all predefined on macOS.
    let minimize = PredefinedMenuItem::minimize(app)?;
    let window_zoom = PredefinedMenuItem::zoom(app)?;
    let window_sep = PredefinedMenuItem::separator(app)?;
    let bring_all_to_front = PredefinedMenuItem::bring_all_to_front(app)?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[&minimize, &window_zoom, &window_sep, &bring_all_to_front],
    )?;

    // ── Assemble top-level menu ──────────────────────────────────────────
    let menu = Menu::with_items(
        app,
        &[
            app_menu.as_ref(),
            edit_menu.as_ref(),
            view_menu.as_ref(),
            window_menu.as_ref(),
        ],
    )?;

    app.set_menu(menu)?;

    // Register the global menu event handler. Predefined items (Undo, Copy,
    // Minimize, etc.) are handled by the OS automatically — only our custom
    // MenuItem entries reach this handler.
    app.on_menu_event(|app_handle, event| {
        let id = event.id.0.as_str();
        match id {
            menu_ids::ABOUT => {
                // Emit to frontend — About dialog is a frontend UI concern.
                let _ = app_handle.emit(EVENT_MENU_ACTION, id);
            }
            menu_ids::QUIT => {
                app_handle.exit(0);
            }
            menu_ids::TOGGLE_FULL_SCREEN
            | menu_ids::ZOOM_IN
            | menu_ids::ZOOM_OUT
            | menu_ids::ACTUAL_SIZE => {
                // Emit to frontend — zoom and fullscreen are CSS-level concerns
                // handled by the webview. The frontend listens for
                // `menu-action` events and dispatches accordingly.
                let _ = app_handle.emit(EVENT_MENU_ACTION, id);
            }
            _ => {
                tracing::debug!(menu_item_id = id, "Unhandled menu item event");
            }
        }
    });

    Ok(())
}

// ── Platform-conditional setup ────────────────────────────────────────────

/// Builds and installs the native macOS menu bar during app setup.
/// On non-macOS platforms this is a no-op.
///
/// Call from `tauri::Builder::setup()` — alongside `tray::setup_tray()`.
pub fn setup_menu_bar(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    {
        let labels = default_labels();
        build_and_install(app, &labels)?;
        tracing::info!("Native macOS menu bar initialized");
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app; // Suppress unused-variable warning.
        tracing::debug!("Menu bar is macOS-only — skipping on this platform");
    }
    Ok(())
}

/// Rebuilds the menu bar with translated labels. Called by the frontend via
/// `cmd_menu_rebuild` when the locale changes. On non-macOS platforms this
/// is a no-op that returns success.
fn rebuild_menu_bar(app: &AppHandle, labels: MenuBarLabels) -> Result<(), BackendError> {
    #[cfg(target_os = "macos")]
    {
        build_and_install(app, &labels).map_err(|e| {
            BackendError::new(
                error_codes::MENU_BAR_ERROR,
                format!("Failed to rebuild menu bar: {}", e),
            )
        })?;
        tracing::info!("Menu bar rebuilt with updated labels");
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, labels);
    }
    Ok(())
}

// ── Thin IPC adapter ─────────────────────────────────────────────────────

/// Thin IPC adapter — no business logic (STANDARDS §6).
///
/// Rebuilds the native menu bar with translated labels sent from the
/// frontend. Takes the translated label struct and delegates to
/// `rebuild_menu_bar`. Returns a boolean success flag.
#[tauri::command]
pub async fn cmd_menu_rebuild(app: AppHandle, labels: MenuBarLabels) -> ApiResponse<bool> {
    tracing::debug!("cmd_menu_rebuild: received translated menu labels");
    match rebuild_menu_bar(&app, labels) {
        Ok(()) => ApiResponse {
            success: true,
            data: Some(true),
            error: None,
        },
        Err(err) => ApiResponse {
            success: false,
            data: Some(false),
            error: Some(err),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_bar_labels_serde_camel_case_round_trip() {
        let labels = MenuBarLabels {
            about: "About Musaed".into(),
            quit: "Quit Musaed".into(),
            toggle_full_screen: "Toggle Full Screen".into(),
            zoom_in: "Zoom In".into(),
            zoom_out: "Zoom Out".into(),
            actual_size: "Actual Size".into(),
        };
        let json = serde_json::to_string(&labels).unwrap();
        // camelCase keys
        assert!(json.contains("\"toggleFullScreen\""));
        assert!(json.contains("\"zoomIn\""));
        assert!(json.contains("\"zoomOut\""));
        assert!(json.contains("\"actualSize\""));

        let back: MenuBarLabels = serde_json::from_str(&json).unwrap();
        assert_eq!(back.about, labels.about);
        assert_eq!(back.quit, labels.quit);
        assert_eq!(back.toggle_full_screen, labels.toggle_full_screen);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn menu_bar_labels_default_produces_english() {
        let labels = default_labels();
        assert_eq!(labels.about, "About Musaed");
        assert_eq!(labels.quit, "Quit Musaed");
        assert_eq!(labels.toggle_full_screen, "Toggle Full Screen");
        assert_eq!(labels.zoom_in, "Zoom In");
        assert_eq!(labels.zoom_out, "Zoom Out");
        assert_eq!(labels.actual_size, "Actual Size");
    }

    #[test]
    fn event_menu_action_constant_is_stable() {
        assert_eq!(EVENT_MENU_ACTION, "menu-action");
    }

    #[test]
    fn menu_ids_are_distinct_strings() {
        let ids = [
            menu_ids::ABOUT,
            menu_ids::QUIT,
            menu_ids::TOGGLE_FULL_SCREEN,
            menu_ids::ZOOM_IN,
            menu_ids::ZOOM_OUT,
            menu_ids::ACTUAL_SIZE,
        ];
        let mut seen = std::collections::HashSet::new();
        for &id in &ids {
            assert!(seen.insert(id), "duplicate menu item id: {}", id);
        }
    }
}
