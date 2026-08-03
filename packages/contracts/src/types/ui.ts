export type Language = 'en' | 'ar';
export type Theme = 'light' | 'dark' | 'system';

/**
 * Native file-dialog filter. Mirrors the Rust `dialog::FileFilter` struct
 * (`src-tauri/src/dialog.rs`) — the `#[serde(rename_all = "camelCase")]`
 * attribute makes the wire shape identical on both sides.
 *
 * Declaring this as a named type (rather than an inline `{ name; extensions }`
 * object literal inside `CommandMap`) keeps `scripts/validate-contracts.mjs`
 * from mis-parsing the filter shape as a sibling arg, and lets the structural
 * comparator match the identifier against the Rust `FileFilter` struct.
 *
 * @see STANDARDS.md §5 — IPC Contract Architecture (contracts as source of truth)
 */
export interface FileFilter {
  name: string;
  extensions: string[];
}
