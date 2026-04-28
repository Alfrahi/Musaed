import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkIsTauri, ollamaApi } from './ipc';
import { mockIPC } from '@tauri-apps/api/mocks';
import { BackendErrorCode } from '@musaed/contracts';

describe('IPC Bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects tauri environment correctly', () => {
    expect(checkIsTauri()).toBe(true);
  });

  it('invokes a command and returns data', async () => {
    const mockModels = [{ name: 'test-model', size: 100, digest: '123', details: {} }];

    mockIPC((cmd) => {
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
