import { describe, it, expect, afterEach } from 'vitest';
import { getPlatform, isMac, isWindows, __resetPlatformCache } from './platform';

const originalNavigator = globalThis.navigator;

function setNavigator(platform: string | undefined, userAgent: string | undefined): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      platform,
      userAgent,
    },
    configurable: true,
    writable: true,
  });
}

describe('platform detection', () => {
  afterEach(() => {
    __resetPlatformCache();
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  describe('getPlatform', () => {
    it('returns "mac" when navigator.platform contains "MacIntel"', () => {
      setNavigator('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)');
      expect(getPlatform()).toBe('mac');
    });

    it('returns "mac" when only userAgent contains "Mac"', () => {
      setNavigator(undefined, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)');
      expect(getPlatform()).toBe('mac');
    });

    it('returns "windows" when navigator.platform contains "Win32"', () => {
      setNavigator('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
      expect(getPlatform()).toBe('windows');
    });

    it('returns "windows" when only userAgent contains "Windows"', () => {
      setNavigator(undefined, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
      expect(getPlatform()).toBe('windows');
    });

    it('returns "linux" when navigator.platform contains "Linux"', () => {
      setNavigator('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)');
      expect(getPlatform()).toBe('linux');
    });

    it('returns "linux" when only userAgent contains "Linux"', () => {
      setNavigator(undefined, 'Mozilla/5.0 (X11; Linux x86_64)');
      expect(getPlatform()).toBe('linux');
    });

    it('returns "unknown" for an unrecognised platform', () => {
      setNavigator('UnknownPlat', 'Mozilla/5.0 (UnknownOS)');
      expect(getPlatform()).toBe('unknown');
    });

    it('memoises the result — detectPlatform is not called twice', () => {
      setNavigator('MacIntel', 'Mozilla/5.0 (Macintosh)');
      expect(getPlatform()).toBe('mac');
      // Change navigator after the first call — cached value should persist
      setNavigator('Win32', 'Mozilla/5.0 (Windows)');
      expect(getPlatform()).toBe('mac');
    });
  });

  describe('isMac', () => {
    it('returns true on macOS', () => {
      setNavigator('MacIntel', 'Mozilla/5.0 (Macintosh)');
      expect(isMac()).toBe(true);
    });

    it('returns false on Windows', () => {
      setNavigator('Win32', 'Mozilla/5.0 (Windows)');
      __resetPlatformCache();
      expect(isMac()).toBe(false);
    });

    it('returns false on Linux', () => {
      setNavigator('Linux x86_64', 'Mozilla/5.0 (Linux)');
      __resetPlatformCache();
      expect(isMac()).toBe(false);
    });
  });

  describe('isWindows', () => {
    it('returns true on Windows', () => {
      setNavigator('Win32', 'Mozilla/5.0 (Windows)');
      expect(isWindows()).toBe(true);
    });

    it('returns false on macOS', () => {
      setNavigator('MacIntel', 'Mozilla/5.0 (Macintosh)');
      __resetPlatformCache();
      expect(isWindows()).toBe(false);
    });

    it('returns false on Linux', () => {
      setNavigator('Linux x86_64', 'Mozilla/5.0 (Linux)');
      __resetPlatformCache();
      expect(isWindows()).toBe(false);
    });
  });

  describe('SSR safety', () => {
    it('returns "unknown" when navigator is undefined', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      __resetPlatformCache();
      expect(getPlatform()).toBe('unknown');
      expect(isMac()).toBe(false);
      expect(isWindows()).toBe(false);
    });
  });
});
