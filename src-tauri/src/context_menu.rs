//! Context-menu domain.
//!
//! Builds native Tauri popup menus for right-click surfaces (conversation row,
//! chat message bubble, code block) and reports the selected item id back to
//! the frontend. Lives in `tauri::menu` core API — no new plugin dependency.
//!
//! Architecture (STANDARDS §6):
//! - `commands::cmd_context_menu_show` — thin IPC adapter only.
//! - `service::show_context_menu`     — domain logic (item list per kind,
//!   menu construction, popup, awaiting selection).
//!
//! @see STANDARDS.md §22 Core architectural model (Rust = system truth layer).

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::menu::{Menu, MenuEvent, MenuItem};
use tauri::{AppHandle, Manager, WebviewWindow};
use tokio::sync::{oneshot, Mutex};

use crate::error_codes;
use crate::payloads::{ApiResponse, BackendError};

/// Surfaces that can show a native context menu. Symmetric with
/// `ContextMenuKindSchema` in `packages/contracts/src/schemas/context-menu.ts`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContextMenuKind {
    Conversation,
    Message,
    CodeBlock,
}

/// Pair of `(action_id, translated_label)` for a single native menu entry.
/// Translations travel from the frontend through the request payload so the
/// Rust side stays locale-agnostic (STANDARDS §11 — no hardcoded strings in
/// the frontend; backend has no notion of locale for menu labels).
struct MenuItemSpec {
    id: &'static str,
    #[allow(dead_code)]
    label: String,
}

/// Response returned to the frontend: the selected action id, or `None` when
/// the user dismissed the menu. Symmetric with `ContextMenuResponseSchema`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuResponse {
    pub selected_item: Option<String>,
}

/// Build the ordered item list for a given surface kind.
///
/// The action ids (`rename`, `delete`, `export`, `copy`, `regenerate`) are the
/// contract between the frontend consumers and the backend domain — they are
/// string literals agreed upon by both layers and correspond to the action set
/// enumerated.
fn items_for_kind(kind: ContextMenuKind, labels: &ContextMenuLabels) -> Vec<MenuItemSpec> {
    match kind {
        ContextMenuKind::Conversation => vec![
            MenuItemSpec {
                id: "rename",
                label: labels.rename.clone(),
            },
            MenuItemSpec {
                id: "export",
                label: labels.export.clone(),
            },
            MenuItemSpec {
                id: "delete",
                label: labels.delete.clone(),
            },
        ],
        ContextMenuKind::Message => vec![
            MenuItemSpec {
                id: "copy",
                label: labels.copy.clone(),
            },
            MenuItemSpec {
                id: "regenerate",
                label: labels.regenerate.clone(),
            },
        ],
        ContextMenuKind::CodeBlock => vec![MenuItemSpec {
            id: "copy",
            label: labels.copy.clone(),
        }],
    }
}

/// Resolve the active webview window via the app handle. Used both to build
/// the menu (menus are owned/managed by the window in Tauri 2) and to anchor
/// the popup.
fn main_window(app: &AppHandle) -> Result<WebviewWindow, BackendError> {
    app.get_webview_window("main").ok_or_else(|| {
        BackendError::new(
            error_codes::CONTEXT_MENU_ERROR,
            "Main window not found for context menu",
        )
    })
}

/// Pops up the native menu at `(x, y)` relative to the window's content area
/// and awaits the user's selection via a oneshot channel bridged from the
/// synchronous menu-event callback.
///
/// `tokio::sync::Mutex` serializes access: a second right-click while the first
/// menu is open waits until the first resolves (Tauri menus are stateful and
/// cannot be popped twice on the same window concurrently — the lock is the
/// structural guard, not just a courtesy).
async fn show_context_menu(
    app: AppHandle,
    kind: ContextMenuKind,
    labels: ContextMenuLabels,
    x: f64,
    y: f64,
) -> Result<ContextMenuResponse, BackendError> {
    static MENU_LOCK: Mutex<()> = Mutex::const_new(());

    let _guard = MENU_LOCK.lock().await;

    let window = main_window(&app)?;

    let items = items_for_kind(kind, &labels);
    if items.is_empty() {
        return Ok(ContextMenuResponse {
            selected_item: None,
        });
    }

    // Build menu items, construct the menu, pop it up, then drop everything
    // before the `.await` so the future is `Send` (the Tauri command macro
    // requires `Send` futures).
    let (tx, rx) = oneshot::channel::<String>();
    {
        let menu_items: Vec<MenuItem<tauri::Wry>> = items
            .iter()
            .map(|it| {
                MenuItem::with_id(&window, it.id, &it.label, true, None::<&str>).map_err(|e| {
                    BackendError::new(
                        error_codes::CONTEXT_MENU_ERROR,
                        format!("Failed to create menu item: {}", e),
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()?;

        let item_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = menu_items
            .iter()
            .map(|item| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
            .collect();

        let menu = Menu::with_items(&window, &item_refs).map_err(|e| {
            BackendError::new(
                error_codes::CONTEXT_MENU_ERROR,
                format!("Failed to build menu: {}", e),
            )
        })?;

        // Register the menu-event callback before showing the popup.
        // `on_menu_event` takes an `Fn` closure (not `FnOnce`), so the
        // sender is wrapped in `Arc<Mutex<Option<...>>>` for interior mutability.
        let tx = Arc::new(StdMutex::new(Some(tx)));
        let tx_clone = Arc::clone(&tx);
        window.on_menu_event(move |_win, event: MenuEvent| {
            if let Some(sender) = tx_clone.lock().ok().and_then(|mut guard| guard.take()) {
                let _ = sender.send(event.id.0.clone());
            }
        });

        // Position injected as a logical (CSS px) offset from the window content
        // origin — matches `MouseEvent.clientX/Y` from the webview.
        window
            .popup_menu_at(
                &menu,
                tauri::Position::Logical(tauri::LogicalPosition::new(x, y)),
            )
            .map_err(|e| {
                BackendError::new(
                    error_codes::CONTEXT_MENU_ERROR,
                    format!("Failed to open popup: {}", e),
                )
            })?;

        // `menu`, `item_refs`, and `menu_items` are dropped here.
    }

    // Await the user's selection; if the menu is dismissed (Escape / outside
    // click), the oneshot sender is dropped and we report `None`.
    let selected = rx.await.ok();

    Ok(ContextMenuResponse {
        selected_item: selected,
    })
}

/// Translated labels shipped from the frontend (STANDARDS §11: backend has no
/// notion of locale for menu labels; the frontend translates and sends the
/// strings).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ContextMenuLabels {
    pub rename: String,
    pub export: String,
    pub delete: String,
    pub copy: String,
    pub regenerate: String,
}

/// Reusable entry point used by the IPC adapter. Kept call-shaped so tests
/// can exercise pure spec list resolution without standing up a Tauri app.
pub async fn dispatch_show_context_menu(
    app: AppHandle,
    kind: ContextMenuKind,
    labels: ContextMenuLabels,
    x: f64,
    y: f64,
) -> ApiResponse<ContextMenuResponse> {
    match show_context_menu(app, kind, labels, x, y).await {
        Ok(resp) => ApiResponse {
            success: true,
            data: Some(resp),
            error: None,
        },
        Err(err) => ApiResponse {
            success: false,
            data: None,
            error: Some(err),
        },
    }
}

/// Thin IPC adapter — no business logic (STANDARDS §6).
///
/// Deserialises the frontend request, resolves the translated labels from the
/// request payload, and delegates to `dispatch_show_context_menu`. The
/// frontend ships translated labels so the backend stays locale-agnostic
/// (STANDARDS §11).
#[tauri::command]
pub async fn cmd_context_menu_show(
    app: AppHandle,
    kind: ContextMenuKind,
    labels: ContextMenuLabels,
    x: f64,
    y: f64,
) -> ApiResponse<ContextMenuResponse> {
    dispatch_show_context_menu(app, kind, labels, x, y).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn items_for_kind_conversation_returns_rename_export_delete() {
        let labels = ContextMenuLabels {
            rename: "Rename".into(),
            export: "Export".into(),
            delete: "Delete".into(),
            copy: "Copy".into(),
            regenerate: "Regenerate".into(),
        };
        let ids: Vec<&'static str> = items_for_kind(ContextMenuKind::Conversation, &labels)
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(ids, vec!["rename", "export", "delete"]);
    }

    #[test]
    fn items_for_kind_message_returns_copy_regenerate() {
        let labels = ContextMenuLabels::default();
        let ids: Vec<&'static str> = items_for_kind(ContextMenuKind::Message, &labels)
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(ids, vec!["copy", "regenerate"]);
    }

    #[test]
    fn items_for_kind_codeblock_returns_copy_only() {
        let labels = ContextMenuLabels::default();
        let ids: Vec<&'static str> = items_for_kind(ContextMenuKind::CodeBlock, &labels)
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(ids, vec!["copy"]);
    }

    #[test]
    fn context_menu_kind_serde_is_camel_case_round_trip() {
        // Mirror the TS contract: `conversation`/`message`/`codeBlock`.
        for (kind, json) in [
            (ContextMenuKind::Conversation, "\"conversation\""),
            (ContextMenuKind::Message, "\"message\""),
            (ContextMenuKind::CodeBlock, "\"codeBlock\""),
        ] {
            let s = serde_json::to_string(&kind).unwrap();
            assert_eq!(s, json);
            let back: ContextMenuKind = serde_json::from_str(json).unwrap();
            assert_eq!(back, kind);
        }
    }

    #[test]
    fn context_menu_response_serializes_camel_case() {
        let with_selection = ContextMenuResponse {
            selected_item: Some("rename".to_string()),
        };
        let json = serde_json::to_string(&with_selection).unwrap();
        assert!(json.contains("\"selectedItem\":\"rename\""));

        let dismissed = ContextMenuResponse {
            selected_item: None,
        };
        let json = serde_json::to_string(&dismissed).unwrap();
        assert!(json.contains("\"selectedItem\":null"));
    }
}
