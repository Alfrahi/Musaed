/**
 * Tauri environment detection.
 *
 * Deduplicated from `ipc.ts` and `logger.ts` (Finding 5).
 * Kept in its own module so both the IPC bridge and the logger can
 * import it without circular-dependency risk or mock-leakage issues.
 */

/**
 * Checks if the current runtime environment is a Tauri desktop application.
 * @returns true if running inside Tauri, false otherwise (e.g., browser dev mode)
 */
export function checkIsTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  );
}
