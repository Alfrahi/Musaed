/**
 * Tauri environment detection.
 *
 * Deduplicated from `ipc.ts` and `logger.ts` (Finding 5).
 * Kept in its own module so both the IPC bridge and the logger can
 * import it without circular-dependency risk or mock-leakage issues.
 */

/**
 * Checks if the current runtime environment is a Tauri desktop application.
 * Requires a working `invoke` bridge, not just the internals object: in
 * tests, `@tauri-apps/api/mocks`' clearMocks() deletes `invoke` but leaves
 * the `__TAURI_INTERNALS__` object behind, and a bare-object check would
 * keep reporting true while every IPC call throws
 * "window.__TAURI_INTERNALS__.invoke is not a function".
 * @returns true if running inside Tauri, false otherwise (e.g., browser dev mode)
 */
export function checkIsTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const internals = (window as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === 'function';
}
