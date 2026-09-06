import { callInternal } from './transport';
import type { ContextMenuRequest, ContextMenuLabels } from '@musaed/contracts';

/**
 * Context Menu API — native Tauri popup menu for right-click surfaces.
 *
 * The frontend sends the surface kind (conversation/message/codeBlock),
 * target id, screen coordinates from the `contextmenu` MouseEvent, and
 * translated labels. The Rust backend builds a native menu and returns
 * the selected action id (or null if the user dismissed the menu).
 *
 * @see STANDARDS.md §5  IPC System
 * @see STANDARDS.md §16 Security Model
 */
export const contextMenuApi = {
  /**
   * Shows a native context menu at the given screen position.
   * @param kind - Surface kind: 'conversation' | 'message' | 'codeBlock'
   * @param x - Screen X coordinate from the contextmenu event
   * @param y - Screen Y coordinate from the contextmenu event
   * @param labels - Translated labels for each menu item
   * @returns The selected action id, or null if dismissed
   */
  show: (
    kind: ContextMenuRequest['kind'],
    x: number,
    y: number,
    labels: Partial<ContextMenuLabels>
  ) =>
    callInternal('cmd_context_menu_show', {
      kind,
      x,
      y,
      labels: {
        rename: '',
        export: '',
        delete: '',
        copy: '',
        regenerate: '',
        ...labels,
      },
    }),
};
