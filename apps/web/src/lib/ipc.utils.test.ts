import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

describe('IPC utility functions', () => {
  let isValidOllamaUrl: (url: string) => boolean;
  let sanitizeOllamaUrl: (url: string) => string;

  beforeEach(async () => {
    // Import actual implementations to avoid mock leakage from other test files
    const ipc = await vi.importActual('./ipc.js');
    isValidOllamaUrl = (ipc as any).isValidOllamaUrl;
    sanitizeOllamaUrl = (ipc as any).sanitizeOllamaUrl;
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('isValidOllamaUrl validates allowed hosts', () => {
    expect(isValidOllamaUrl('http://localhost:11434')).toBe(true);
    expect(isValidOllamaUrl('https://127.0.0.1')).toBe(true);
    expect(isValidOllamaUrl('http://192.168.1.5')).toBe(true);
    expect(isValidOllamaUrl('https://example.com')).toBe(false);
    expect(isValidOllamaUrl('not-a-url')).toBe(false);
  });

  it('sanitizeOllamaUrl strips path and query', () => {
    const url = 'http://localhost:11434/api/v1?foo=bar#section';
    expect(sanitizeOllamaUrl(url)).toBe('http://localhost:11434');
    expect(sanitizeOllamaUrl('invalid')).toBe('invalid');
  });
});
