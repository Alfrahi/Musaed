import { callInternal } from './transport';

/**
 * System Tray API — query background-task status.
 *
 * Returns the active background operations (chat streams, model pulls, RAG
 * indexing) so the frontend can show status indicators or decide whether
 * it's safe to close the window. Declared as a SHARED_COMMAND so any feature
 * can consume it without a manifest dependency.
 *
 * @see STANDARDS.md §5  IPC System
 * @see STANDARDS.md §13 Failure Mode Rule
 */
export const trayApi = {
  /**
   * Returns the current background-task status.
   *
   * @returns An object with `tasks` (array of active task kinds + counts)
   * and `hasActiveTasks` (convenience boolean). Returns `null` when running
   * outside Tauri or if the call fails.
   */
  getBackgroundStatus: () => callInternal('cmd_tray_get_background_status', {}),
};
