import { callInternal } from './transport';

/**
 * Opener API - handles external URL opening.
 */
export const openerApi = {
  /**
   * Opens a URL in the user's default browser.
   * @param url - The URL to open
   * @returns true if URL was opened successfully, false otherwise
   */
  openUrl: (url: string) => callInternal('cmd_opener_open_url', { url }),
};
