import { callInternal } from './transport';
import type { CommandMap } from '@musaed/contracts';
import type { DialogKind } from '@musaed/contracts';

/**
 * Dialog API - manages user dialog interactions.
 */
export const dialogApi = {
  /**
   * Shows a dialog to the user and returns their response.
   * @param title - The dialog title
   * @param message - The dialog message
   * @param kind - Optional dialog kind (e.g., 'info', 'warning', 'error')
   * @returns true if user confirmed, false if cancelled
   */
  ask: (title: string, message: string, kind?: DialogKind) =>
    callInternal('cmd_dialog_ask', { title, message, kind }),

  /**
   * Shows a native file/folder open dialog and returns the selected path(s).
   * @param opts - { filters?, multiple?, directory?, defaultPath? }
   * @returns Array of selected paths, or null if cancelled
   */
  openFile: (opts: CommandMap['cmd_dialog_open_file']['args']) =>
    callInternal('cmd_dialog_open_file', opts),

  /**
   * Shows a native file save dialog and returns the selected path.
   * @param opts - { filters?, defaultPath? }
   * @returns The selected save path, or null if cancelled
   */
  saveFile: (opts: CommandMap['cmd_dialog_save_file']['args']) =>
    callInternal('cmd_dialog_save_file', opts),
};
