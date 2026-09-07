import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { DEFAULT_SETTINGS, type ChatSettings } from '@musaed/contracts';

vi.mock('./transport', () => ({
  callInternal: vi.fn(),
}));

import { storeApi } from './store';
import { callInternal } from './transport';

describe('storeApi typed accessors (MEDIUM-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTyped', () => {
    it('returns the parsed value when it satisfies the schema', async () => {
      vi.mocked(callInternal).mockResolvedValue('dark');
      const result = await storeApi.getTyped(
        'settings.json',
        'theme',
        z.enum(['light', 'dark', 'system'])
      );
      expect(result).toBe('dark');
      expect(callInternal).toHaveBeenCalledWith('cmd_store_get', {
        file: 'settings.json',
        key: 'theme',
      });
    });

    it('returns null for a missing key', async () => {
      vi.mocked(callInternal).mockResolvedValue(null);
      const result = await storeApi.getTyped('settings.json', 'theme', z.string());
      expect(result).toBeNull();
    });

    it('returns null when the stored value fails schema validation', async () => {
      vi.mocked(callInternal).mockResolvedValue(42);
      const result = await storeApi.getTyped('settings.json', 'theme', z.string());
      expect(result).toBeNull();
    });
  });

  describe('getSettings / getTheme', () => {
    const persisted = (settings: Partial<ChatSettings>) =>
      JSON.stringify({ state: { globalSettings: settings }, version: 5 });

    it('parses a valid persisted settings payload', async () => {
      vi.mocked(callInternal).mockResolvedValue(persisted(DEFAULT_SETTINGS));
      const settings = await storeApi.getSettings();
      expect(settings?.theme).toBe(DEFAULT_SETTINGS.theme);
      expect(callInternal).toHaveBeenCalledWith('cmd_store_get', {
        file: 'settings-state.json',
        key: 'musaed-settings-storage',
      });
    });

    it('returns the theme from a valid payload', async () => {
      vi.mocked(callInternal).mockResolvedValue(persisted({ ...DEFAULT_SETTINGS, theme: 'dark' }));
      await expect(storeApi.getTheme()).resolves.toBe('dark');
    });

    it('returns null for non-string payloads', async () => {
      vi.mocked(callInternal).mockResolvedValue({ state: {} });
      await expect(storeApi.getSettings()).resolves.toBeNull();
    });

    it('returns null for invalid JSON', async () => {
      vi.mocked(callInternal).mockResolvedValue('{not json');
      await expect(storeApi.getSettings()).resolves.toBeNull();
    });

    it('returns null when the settings object fails ChatSettingsSchema', async () => {
      vi.mocked(callInternal).mockResolvedValue(
        persisted({ ...DEFAULT_SETTINGS, theme: 'banana' as unknown as ChatSettings['theme'] })
      );
      await expect(storeApi.getSettings()).resolves.toBeNull();
    });

    it('returns null when the key is missing', async () => {
      vi.mocked(callInternal).mockResolvedValue(null);
      await expect(storeApi.getTheme()).resolves.toBeNull();
    });
  });
});
