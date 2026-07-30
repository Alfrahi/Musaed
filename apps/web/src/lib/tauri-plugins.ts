/**
 * Tauri plugin wrappers with browser fallbacks.
 *
 * Extracted from `ipc.ts` (Finding 12) to keep the IPC bridge focused on
 * command routing and latency tracking. Each wrapper provides a unified API
 * that delegates to the native Tauri plugin when running in Tauri, or falls
 * back to a browser-compatible implementation otherwise.
 */

import type { StoreOptions as StoreOptionsFull } from '@tauri-apps/plugin-store';
import { checkIsTauri } from '@/lib/tauri-detection';
import { isOpenerUrlAllowed } from '@/lib/url-allowlist';

// ====================== DIALOG ======================

/**
 * Options for the confirmation dialog, mirroring `@tauri-apps/plugin-dialog`'s
 * `ConfirmDialogOptions` so consumers can pass translated `okLabel` /
 * `cancelLabel` without casting. The browser fallback ignores labels
 * (window.confirm has no such customization) but still returns a boolean.
 */
export interface ConfirmDialogOptions {
  title?: string;
  kind?: 'info' | 'warning' | 'error';
  /** Label for the confirm button. Tauri-only; ignored by browser fallback. */
  okLabel?: string;
  /** Label for the cancel button. Tauri-only; ignored by browser fallback. */
  cancelLabel?: string;
}

/**
 * Wrapper around Tauri's dialog plugin with browser fallbacks.
 * - `ask`: Shows a confirmation dialog; uses window.confirm in browser.
 * - `save`: Shows a file save dialog; returns null in browser.
 * - `open`: Shows a file/folder open dialog; returns null in browser.
 */
export const dialog = {
  ask: async (msg: string, opts: ConfirmDialogOptions) =>
    checkIsTauri()
      ? (await import('@tauri-apps/plugin-dialog')).ask(msg, opts)
      : window.confirm(msg),
  save: async (opts: {
    filters: { name: string; extensions: string[] }[];
    defaultPath?: string;
  }) => (checkIsTauri() ? (await import('@tauri-apps/plugin-dialog')).save(opts) : null),
  open: async (opts: {
    filters?: { name: string; extensions: string[] }[];
    multiple?: boolean;
    directory?: boolean;
    defaultPath?: string;
  }): Promise<string | string[] | null> =>
    checkIsTauri() ? (await import('@tauri-apps/plugin-dialog')).open(opts) : null,
};

// ==============================================================================
// OPENER
// ==============================================================================

/**
 * Wrapper around Tauri's opener plugin.
 * - `openUrl`: Opens a URL in the default browser; uses window.open in browser
 *   (may be blocked). URLs are validated against the allowlist before being
 *   passed to the native layer.
 */
export const opener = {
  openUrl: async (url: string) => {
    if (!isOpenerUrlAllowed(url)) return;
    if (checkIsTauri()) {
      return (await import('@tauri-apps/plugin-opener')).openUrl(url);
    }
    // Validate URL protocol before opening in browser dev mode
    const allowedProtocols = ['http:', 'https:', 'mailto:'];
    try {
      const parsed = new URL(url);
      if (!allowedProtocols.includes(parsed.protocol)) return;
    } catch {
      return; // Invalid URL — silently reject
    }
    window.open(url, '_blank');
  },
};

// ==============================================================================
// STORE
// ==============================================================================

/**
 * Wrapper around Tauri's store plugin for persistent key-value storage.
 * - `load`: Loads a store file; returns null in browser.
 * Provides a simple key-value store interface backed by a JSON file.
 */
export type StoreOptions = Partial<StoreOptionsFull>;

export const store = {
  load: async (file: string, opts?: StoreOptions) =>
    checkIsTauri()
      ? (await import('@tauri-apps/plugin-store')).load(file, opts as StoreOptionsFull)
      : null,
};

// ==============================================================================
// FILESYSTEM
// ==============================================================================

/**
 * Wrapper around Tauri's filesystem plugin.
 * - `writeTextFile`: Writes a text file to the local filesystem.
 * - `readTextFile`: Reads a text file and returns its contents as a string.
 * - `readFile`: Reads a binary file and returns a Uint8Array.
 * All methods are no-ops (return null/undefined) when running in a browser.
 */
export const fs = {
  writeTextFile: async (path: string, content: string) =>
    checkIsTauri() && (await import('@tauri-apps/plugin-fs')).writeTextFile(path, content),
  readTextFile: async (path: string): Promise<string | null> =>
    checkIsTauri() ? (await import('@tauri-apps/plugin-fs')).readTextFile(path) : null,
  readFile: async (path: string): Promise<Uint8Array | null> =>
    checkIsTauri() ? (await import('@tauri-apps/plugin-fs')).readFile(path) : null,
};