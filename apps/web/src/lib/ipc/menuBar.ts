import { callInternal } from './transport';
import type { MenuBarLabels } from '@musaed/contracts';

/**
 * Menu bar IPC API.
 *
 * @see STANDARDS.md §5  IPC System
 * @see STANDARDS.md §13 Failure Mode Rule
 */
export const menuBarApi = {
  /**
   * Rebuilds the native macOS menu bar with translated labels.
   *
   * Called after locale hydration or when the user switches language. On
   * Windows/Linux this is a no-op that returns `true`.
   *
   * @param labels - Translated labels for the custom (non-predefined) menu items.
   * @returns `true` on success, `null` if running outside Tauri.
   */
  rebuild: (labels: MenuBarLabels) => callInternal('cmd_menu_rebuild', { labels }),
};
