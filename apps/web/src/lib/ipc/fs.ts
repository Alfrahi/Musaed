import { callInternal } from './transport';

/**
 * Filesystem API - file read/write operations via Rust commands.
 *
 * Replaces the direct `@tauri-apps/plugin-fs` plugin wrapper. All
 * filesystem access now goes through `callInternal` for validation,
 * latency tracking, and error sanitization (STANDARDS §16).
 */
export const fsApi = {
  /**
   * Reads a text file from the filesystem.
   * @param path - Absolute path to the file
   * @returns The file contents as a string, or null on failure
   */
  readTextFile: (path: string) => callInternal('cmd_fs_read_text_file', { path }),

  /**
   * Reads a binary file from the filesystem, returned as base64.
   * @param path - Absolute path to the file
   * @returns Base64-encoded file contents, or null on failure
   */
  readFile: (path: string) => callInternal('cmd_fs_read_file', { path }),

  /**
   * Writes text content to a file on the filesystem.
   * @param path - Absolute path to the file
   * @param content - Text content to write
   * @returns true if the write succeeded
   */
  writeTextFile: (path: string, content: string) =>
    callInternal('cmd_fs_write_text_file', { path, content }),
};
