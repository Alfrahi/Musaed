import { callInternal } from './transport';

/**
 * App Metadata API — read-only application info sourced from
 * `tauri.conf.json` via the compile-time embedded `PackageInfo`.
 *
 * The version returned here is the single source of truth — `Cargo.toml`
 * and `apps/web/package.json` are aligned to match it so the installer,
 * About modal, and sidebar all show the same string.
 *
 * Declared as a SHARED_COMMAND in `packages/contracts/src/command-versions.ts`
 * so any feature can consume it without declaring an IPC endpoint in its
 * feature manifest.
 *
 * @see STANDARDS.md §5  IPC System
 * @see STANDARDS.md §10 IPC + Rust contract alignment
 */
export const appApi = {
  /**
   * Returns the canonical application version string (e.g. `"0.1.1"`).
   *
   * The promise rejects to `null` when running outside Tauri (dev/SSR
   * guard) — callers should treat `null` as "unknown" and render a
   * fallback rather than a hardcoded literal.
   */
  getVersion: () => callInternal('cmd_get_app_version', {}),
};
