import { z } from 'zod';

/**
 * Native macOS menu bar contracts (UX-UI-AUDIT Phase 5 Prompt 13, L-1).
 *
 * The frontend calls `cmd_menu_rebuild` with translated labels so the Rust
 * backend can rebuild the native macOS menu bar when the user's locale
 * changes. At initial setup the backend uses English defaults (matching the
 * tray precedent) and the frontend calls `cmd_menu_rebuild` after locale
 * hydration to supply translated labels.
 *
 * The menu bar is macOS-only — on Windows/Linux the command is a no-op.
 *
 * @see STANDARDS.md §5  IPC System
 * @see STANDARDS.md §10 IPC + Rust contract alignment
 * @see STANDARDS.md §11 i18n — no hardcoded strings in frontend
 */

/**
 * Menu item action ids emitted via the `menu-action` Tauri event when a
 * custom (non-predefined) menu item is activated. The frontend listens for
 * these and dispatches the corresponding action (zoom, about, fullscreen).
 *
 * Predefined menu items (Undo, Copy, Minimize, etc.) are handled by the OS
 * and do not reach the frontend.
 */
export const MenuActionIdSchema = z.enum([
  'menu-about',
  'menu-quit',
  'menu-toggle-fullscreen',
  'menu-zoom-in',
  'menu-zoom-out',
  'menu-actual-size',
]);

export type MenuActionId = z.infer<typeof MenuActionIdSchema>;

/**
 * Translated labels for the custom (non-predefined) menu items.
 *
 * Sent from the frontend so the Rust backend stays locale-agnostic
 * (STANDARDS §11). Symmetric with the Rust `MenuBarLabels` struct in
 * `src-tauri/src/menu_bar.rs`.
 *
 * Predefined menu items (Undo, Redo, Cut, Copy, Paste, Select All, Hide,
 * Hide Others, Show All, Services, Minimize, Zoom, Bring All to Front) get
 * OS-localized labels for free and are NOT included in this struct.
 */
export const MenuBarLabelsSchema = z
  .object({
    /** App menu — "About Musaed" */
    about: z.string().min(1),
    /** App menu — "Quit Musaed" */
    quit: z.string().min(1),
    /** View menu — "Toggle Full Screen" */
    toggleFullScreen: z.string().min(1),
    /** View menu — "Zoom In" */
    zoomIn: z.string().min(1),
    /** View menu — "Zoom Out" */
    zoomOut: z.string().min(1),
    /** View menu — "Actual Size" */
    actualSize: z.string().min(1),
  })
  .strict();

export type MenuBarLabels = z.infer<typeof MenuBarLabelsSchema>;
