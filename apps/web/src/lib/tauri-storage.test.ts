import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('@/lib/ipc', () => ({
  checkIsTauri: vi.fn(),
  storeApi: {
    load: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/migrations', () => ({
  runMigrations: vi.fn(),
  MigrationError: class MigrationError extends Error {
    code: string;
    fromVersion: number;
    toVersion: number;
    constructor(code: string, from: number, to: number, message: string, _cause?: Error) {
      super(message);
      this.code = code;
      this.fromVersion = from;
      this.toVersion = to;
    }
    toJSON() {
      return { code: this.code, message: this.message };
    }
  },
  MigrationErrorCode: {
    MIGRATION_FAILED: 'MIGRATION_FAILED',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    MISSING_MIGRATION: 'MISSING_MIGRATION',
    INVALID_VERSION_SEQUENCE: 'INVALID_VERSION_SEQUENCE',
    ROLLBACK_FAILED: 'ROLLBACK_FAILED',
  },
}));

import { createTauriStorage } from './tauri-storage';
import { checkIsTauri, storeApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';
import { runMigrations } from '@/lib/migrations';

describe('Tauri Storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkIsTauri).mockReturnValue(false);
    vi.mocked(runMigrations).mockResolvedValue({
      success: true,
      fromVersion: 0,
      toVersion: 1,
    });
    delete (window as any).__TAURI_INTERNALS__;
  });

  describe('non-Tauri environment (browser dev mode)', () => {
    it('getItem should use localStorage fallback', async () => {
      const storage = createTauriStorage('test.json', 1);
      localStorage.setItem('test-key', 'test-value');

      const result = await storage.getItem('test-key');
      expect(result).toBe('test-value');
    });

    it('setItem should use localStorage fallback', async () => {
      const storage = createTauriStorage('test.json', 1);
      await storage.setItem('test-key', 'test-value');

      expect(localStorage.getItem('test-key')).toBe('test-value');
    });

    it('removeItem should use localStorage fallback', async () => {
      const storage = createTauriStorage('test.json', 1);
      localStorage.setItem('test-key', 'test-value');
      await storage.removeItem('test-key');

      expect(localStorage.getItem('test-key')).toBeNull();
    });
  });

  describe('Tauri environment', () => {
    beforeEach(() => {
      (window as any).__TAURI_INTERNALS__ = {};
      vi.mocked(checkIsTauri).mockReturnValue(true);
      vi.mocked(storeApi.load).mockResolvedValue(true);
      vi.mocked(storeApi.get).mockResolvedValue(null);
      vi.mocked(storeApi.set).mockResolvedValue(true);
      vi.mocked(storeApi.save).mockResolvedValue(true);
      vi.mocked(storeApi.delete).mockResolvedValue(true);
    });

    afterEach(() => {
      delete (window as any).__TAURI_INTERNALS__;
    });

    describe('getItem', () => {
      it('should return null when storeApi.get returns null', async () => {
        vi.mocked(storeApi.get).mockResolvedValue(null);
        const storage = createTauriStorage('test.json', 1);

        const result = await storage.getItem('test-key');
        expect(result).toBeNull();
      });

      it('should return string value when storeApi.get returns data', async () => {
        vi.mocked(storeApi.get).mockResolvedValue('{"key": "value"}');
        const storage = createTauriStorage('test.json', 1);

        const result = await storage.getItem('test-key');
        expect(result).toBe('{"key": "value"}');
      });

      it('should JSON-stringify non-string values', async () => {
        vi.mocked(storeApi.get).mockResolvedValue({ key: 'value' });
        const storage = createTauriStorage('test.json', 1);

        const result = await storage.getItem('test-key');
        expect(result).toBe(JSON.stringify({ key: 'value' }));
      });

      it('should return null on error', async () => {
        vi.mocked(storeApi.load).mockRejectedValue(new Error('Load failed'));
        const storage = createTauriStorage('test.json', 1);

        const result = await storage.getItem('test-key');
        expect(result).toBeNull();
      });

      it('should run migrations before getting value', async () => {
        const testData = { data: 'test' };
        vi.mocked(storeApi.get).mockResolvedValue(JSON.stringify(testData));
        const migrationFn = vi.fn().mockReturnValue({ data: 'migrated' });
        const storage = createTauriStorage('test.json', 1, { 1: migrationFn });

        await storage.getItem('test-key');

        expect(runMigrations).toHaveBeenCalledWith(
          { data: 'test' },
          {
            currentVersion: 1,
            migrations: { 1: expect.any(Function) },
            validate: expect.any(Function),
            defaultState: {},
            storeName: 'test.json',
          }
        );
      });
    });

    describe('setItem', () => {
      it('should set value and save store', async () => {
        const storage = createTauriStorage('test.json', 1);
        await storage.setItem('test-key', 'test-value');

        expect(storeApi.set).toHaveBeenCalledWith('test.json', 'test-key', 'test-value');
        expect(storeApi.save).toHaveBeenCalledWith('test.json');
      });

      it('should log error on save failure', async () => {
        vi.mocked(storeApi.save).mockRejectedValue(new Error('Save failed'));
        const storage = createTauriStorage('test.json', 1);

        await storage.setItem('test-key', 'test-value');

        expect(logger.error).toHaveBeenCalledWith('Save error: test.json', {
          error: expect.any(Error),
        });
      });
    });

    describe('removeItem', () => {
      it('should delete key and save store', async () => {
        const storage = createTauriStorage('test.json', 1);
        await storage.removeItem('test-key');

        expect(storeApi.delete).toHaveBeenCalledWith('test.json', 'test-key');
        expect(storeApi.save).toHaveBeenCalledWith('test.json');
      });

      it('should log error on delete failure', async () => {
        vi.mocked(storeApi.delete).mockRejectedValue(new Error('Delete failed'));
        const storage = createTauriStorage('test.json', 1);

        await storage.removeItem('test-key');

        expect(logger.error).toHaveBeenCalledWith('Remove error: test.json', {
          error: expect.any(Error),
        });
      });
    });
  });
});
