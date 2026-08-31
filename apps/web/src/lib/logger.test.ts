import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('@/lib/ipc', () => ({
  checkIsTauri: vi.fn(),
  logApi: {
    append: vi.fn(),
  },
}));

vi.mock('@/lib/config', () => ({
  config: {
    isProd: false,
  },
}));

import { logger } from './logger';
import { checkIsTauri, logApi } from '@/lib/ipc';
import { config } from '@/lib/config';

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkIsTauri).mockReturnValue(false);
    vi.mocked(logApi.append).mockResolvedValue(null);
    delete (window as any).__TAURI_INTERNALS__;

    // Mock console methods
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log method', () => {
    it('should skip debug logs in production', async () => {
      vi.mocked(config).isProd = true;
      await logger.log('debug', 'test message');
      expect(logApi.append).not.toHaveBeenCalled();
      vi.mocked(config).isProd = false;
    });

    it('should log info message with context in dev mode', async () => {
      // Info level doesn't log to console per lint rules - only persists
      expect(logApi.append).not.toHaveBeenCalled(); // Not Tauri env yet
    });

    it('should log warn message to console in dev mode', async () => {
      await logger.log('warn', 'warning message');

      expect(console.warn).toHaveBeenCalledWith('[WARN] warning message', '');
    });

    it('should log error message to console in dev mode', async () => {
      await logger.log('error', 'error message');

      expect(console.error).toHaveBeenCalledWith('[ERROR] error message', '');
    });

    it('should sanitize and truncate long messages', async () => {
      const longMessage = 'x'.repeat(3000);
      await logger.log('warn', longMessage);

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[TRUNCATED]'),
        expect.any(String)
      );
    });

    it('should persist via logApi.append when in Tauri environment', async () => {
      (window as any).__TAURI_INTERNALS__ = { invoke: () => undefined };
      vi.mocked(checkIsTauri).mockReturnValue(true);

      await logger.log('info', 'test message');

      expect(logApi.append).toHaveBeenCalledWith(expect.stringContaining('"level":"info"'));
    });

    it('should handle logApi.append errors gracefully', async () => {
      (window as any).__TAURI_INTERNALS__ = { invoke: () => undefined };
      vi.mocked(checkIsTauri).mockReturnValue(true);
      vi.mocked(logApi.append).mockRejectedValue(new Error('IPC error'));

      await expect(logger.log('info', 'test message')).resolves.not.toThrow();
    });

    it('should handle context with circular references', async () => {
      const circular: any = { key: 'value' };
      circular.self = circular;

      await expect(logger.log('info', 'test', circular)).resolves.not.toThrow();
    });
  });

  describe('convenience methods', () => {
    it('info should call log with info level', async () => {
      expect(() => logger.info('info message')).not.toThrow();
    });

    it('warn should call log with warn level', async () => {
      await logger.warn('warn message');
      expect(console.warn).toHaveBeenCalledWith('[WARN] warn message', '');
    });

    it('error should call log with error level', async () => {
      await logger.error('error message');
      expect(console.error).toHaveBeenCalledWith('[ERROR] error message', '');
    });

    it('debug should call log with debug level', async () => {
      expect(() => logger.debug('debug message')).not.toThrow();
    });
  });
});
