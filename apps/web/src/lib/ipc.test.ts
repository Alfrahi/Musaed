import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mocks

// Mock Tauri core API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Opt out of the global ipc mock so we can test the real implementation
vi.unmock('@/lib/ipc');

// Import the mocked Tauri invoke function (from mocked module)
import { invoke } from '@tauri-apps/api/core';
// Import the real IPC bridge implementation to test
import { checkIsTauri, ollamaApi } from '@/lib/ipc';
import { BackendErrorCode } from '@musaed/contracts';

describe('IPC Bridge', () => {
  beforeEach(() => {
    // Mock Tauri environment — the detection check requires a working
    // invoke bridge, not just the internals object.
    (window as any).__TAURI_INTERNALS__ = { invoke: () => undefined };
    // Reset the invoke mock to a clean state before each test
    (invoke as any).mockReset();
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it('detects tauri environment correctly', () => {
    expect(checkIsTauri()).toBe(true);
  });

  it('invokes a command and returns data', async () => {
    const mockModels = [{ name: 'test-model', size: 100, digest: '123', details: {} }];
    vi.mocked(invoke).mockResolvedValue({ success: true, data: mockModels });

    const result = await ollamaApi.getModels('http://localhost:11434');
    expect(result).toEqual(mockModels);
    expect(invoke).toHaveBeenCalledWith('cmd_ollama_get_models', {
      baseUrl: 'http://localhost:11434',
    });
  });

  it('handles backend errors gracefully', async () => {
    vi.mocked(invoke).mockResolvedValue({
      success: false,
      error: {
        code: BackendErrorCode.OllamaUnavailable,
        message: 'Ollama is down',
      },
    });

    const result = await ollamaApi.getModels('http://localhost:11434');
    expect(result).toBeNull();
  });

  it('calls cmd_ollama_abort_pull with the model name', async () => {
    vi.mocked(invoke).mockResolvedValue({ success: true, data: null });

    await ollamaApi.abortPull('llama3:8b');

    expect(invoke).toHaveBeenCalledWith('cmd_ollama_abort_pull', {
      name: 'llama3:8b',
    });
  });

  it('rejects invalid model names without invoking the backend', async () => {
    const result = await ollamaApi.abortPull('bad name with spaces!');

    expect(result).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
