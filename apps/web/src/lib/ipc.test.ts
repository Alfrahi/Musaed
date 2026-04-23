import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { checkIsTauri, ollamaApi } from './ipc';
import { mockIPC } from '@tauri-apps/api/mocks';
import { BackendErrorCode } from '@musaed/contracts';

describe('IPC Bridge', () => {
  beforeAll(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: vi.fn(),
        plugins: {},
      },
      writable: true,
      configurable: true,
    });
  });

  afterAll(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects tauri environment correctly', () => {
    expect(checkIsTauri()).toBe(true);
  });

  it('invokes a command and returns data', async () => {
    const mockModels = [{ name: 'test-model', size: 100, digest: '123', details: {} }];

    mockIPC((cmd, args) => {
      if (cmd === 'get_ollama_models') {
        return { success: true, data: mockModels };
      }
    });

    const result = await ollamaApi.getModels('http://localhost:11434');
    expect(result).toEqual(mockModels);
  });

  it('handles backend errors gracefully', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_ollama_models') {
        return {
          success: false,
          error: { code: BackendErrorCode.OllamaUnavailable, message: 'Ollama is down' }
        };
      }
    });

    const result = await ollamaApi.getModels('http://localhost:11434');
    expect(result).toBeNull();
  });
});
