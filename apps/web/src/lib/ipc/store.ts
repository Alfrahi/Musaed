import { callInternal } from './transport';

/**
 * Store API - persistent key-value storage via Rust commands.
 *
 * Replaces the direct tauri-plugin-store wrapper. All store operations
 * now route through `callInternal`, which provides Zod validation,
 * latency tracking, and error sanitization.
 */
export const storeApi = {
  /**
   * Loads a store file.
   * @param file - Store filename (e.g. "logs.json")
   * @returns true if the store was loaded successfully
   */
  load: (file: string) => callInternal('cmd_store_load', { file }),

  /**
   * Gets a value from a store by key.
   * @param file - Store filename
   * @param key - The key to retrieve
   * @returns The value if found, null otherwise
   */
  get: (file: string, key: string) => callInternal('cmd_store_get', { file, key }),

  /**
   * Sets a value in a store by key.
   * @param file - Store filename
   * @param key - The key to set
   * @param value - JSON-serializable value to store
   * @returns true if the value was set
   */
  set: (file: string, key: string, value: unknown) =>
    callInternal('cmd_store_set', { file, key, value }),

  /**
   * Saves a store to disk.
   * @param file - Store filename
   * @returns true if saved successfully
   */
  save: (file: string) => callInternal('cmd_store_save', { file }),

  /**
   * Deletes a key from a store.
   * @param file - Store filename
   * @param key - The key to delete
   * @returns true if the key was deleted
   */
  delete: (file: string, key: string) => callInternal('cmd_store_delete', { file, key }),
};
