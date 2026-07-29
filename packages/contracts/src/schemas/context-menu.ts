import { z } from 'zod';
import { VALIDATION_LIMITS } from '../constants';

/**
 * Context-menu contracts (UX-UI-AUDIT Prompt 12, F13).
 *
 * The frontend fires `cmd_context_menu_show` on a `contextmenu` event with
 * the kind of surface it came from and the target id. The Rust backend builds
 * a native Tauri menu for that kind, pops it up at `(x, y)`, and returns the
 * selected item id (or `null` if the user dismissed the menu).
 *
 * Why a backend-built native menu instead of an in-app HTML menu:
 * the audit (F13) and STANDARDS §22 explicitly demand a desktop-native feel;
 * Tauri 2 exposes native popup menus through the core `tauri::menu` API,
 * so no new plugin dependency is required (STANDARDS §21 — do not invent
 * dependencies).
 *
 * @see STANDARDS.md §5  IPC System
 * @see STANDARDS.md §10 IPC + Rust contract alignment
 * @see STANDARDS.md §16 Security Model — IPC input validation required
 */

/**
 * Surfaces that can show a native context menu.
 *
 * Map onto the audit's three right-click targets:
 *  - `conversation` — sidebar conversation row
 *  - `message`      — chat message bubble
 *  - `codeBlock`    — fenced code block inside a message
 */
export const ContextMenuKindSchema = z.enum(['conversation', 'message', 'codeBlock']);

/**
 * Request payload from frontend to backend.
 *
 * `targetId` is opaque to the IPC layer — the frontend keeps the mapping
 * from id to actual conversation/message; it is just echoed back so the
 * backend does not need to know about every domain entity.
 *
 * `x` / `y` are screen coordinates from the originating `contextmenu`
 * `MouseEvent` (CSS pixels in the webview).
 */
export const ContextMenuRequestSchema = z.object({
  kind: ContextMenuKindSchema,
  targetId: z
    .string()
    .min(1)
    .max(VALIDATION_LIMITS.MAX_MESSAGE_CONTENT_LEN, 'targetId exceeds size limit'),
  x: z.number().finite(),
  y: z.number().finite(),
});

/**
 * Translated labels for context menu items. Sent from the frontend so the
 * Rust backend stays locale-agnostic (STANDARDS §11). Symmetric with the
 * Rust `ContextMenuLabels` struct in `src-tauri/src/context_menu.rs`.
 */
export const ContextMenuLabelsSchema = z.object({
  rename: z.string(),
  export: z.string(),
  delete: z.string(),
  copy: z.string(),
  regenerate: z.string(),
});

/**
 * Response payload from backend to frontend.
 *
 * `selectedItem` is one of the menu-action ids agreed for the `kind`
 * (see `CONTEXT_MENU_ITEMS`), or `null` when the user dismissed the menu
 * (clicked elsewhere or pressed Escape).
 */
export const ContextMenuResponseSchema = z.object({
  selectedItem: z.string().nullable(),
});

export const ContextMenuKind = ContextMenuKindSchema.enum;
export type ContextMenuKind = z.infer<typeof ContextMenuKindSchema>;
export type ContextMenuRequest = z.infer<typeof ContextMenuRequestSchema>;
export type ContextMenuResponse = z.infer<typeof ContextMenuResponseSchema>;
export type ContextMenuLabels = z.infer<typeof ContextMenuLabelsSchema>;
