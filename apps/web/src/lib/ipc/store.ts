import { callInternal } from './transport';
import { ChatSettingsSchema, type ChatSettings } from '@musaed/contracts';
import { z } from 'zod';

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
   *
   * Escape hatch only — returns `unknown` at the type level. Prefer
   * {@link storeApi.getTyped} (or a known-key helper like {@link storeApi.getSettings})
   * so the value is validated against a Zod schema before callers trust it.
   * @param file - Store filename
   * @param key - The key to retrieve
   * @returns The value if found, null otherwise
   */
  get: (file: string, key: string) => callInternal('cmd_store_get', { file, key }),

  /**
   * Gets and Zod-validates a value from a store by key.
   * @returns The parsed value typed as `z.infer<S>`, or null when the key is
   *          missing or the stored value fails validation.
   * @param schema - Zod schema the stored value must satisfy
   */
  getTyped: async <S extends z.ZodTypeAny>(
    file: string,
    key: string,
    schema: S
  ): Promise<z.infer<S> | null> => {
    const raw = await callInternal('cmd_store_get', { file, key });
    if (raw === null || raw === undefined) return null;
    const result = schema.safeParse(raw);
    return result.success ? result.data : null;
  },

  /**
   * Reads persisted chat settings from `settings-state.json` with full Zod
   * validation, independent of the zustand hydration path (useful for
   * diagnostics/migration tooling). Returns null when absent or invalid.
   */
  getSettings: async (): Promise<ChatSettings | null> => {
    const raw = await callInternal('cmd_store_get', {
      file: 'settings-state.json',
      key: 'musaed-settings-storage',
    });
    if (typeof raw !== 'string') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const envelope = z
      .object({ state: z.object({ globalSettings: z.unknown() }) })
      .safeParse(parsed);
    if (!envelope.success) return null;
    const settings = ChatSettingsSchema.safeParse(envelope.data.state.globalSettings);
    return settings.success ? settings.data : null;
  },

  /**
   * Reads the persisted theme preference, validated against the settings
   * schema. Returns null when absent or invalid.
   */
  getTheme: async (): Promise<ChatSettings['theme'] | null> => {
    const settings = await storeApi.getSettings();
    return settings?.theme ?? null;
  },

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
