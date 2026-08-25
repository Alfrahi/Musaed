import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockValidateModel = vi.fn();

vi.mock('@/lib/ipc', () => ({
  __esModule: true,
  ollamaApi: {
    validateModel: (...args: unknown[]) => mockValidateModel(...args),
  },
}));

import {
  fetchModelCapabilities,
  getCachedModelCapabilities,
  clearModelCapabilitiesCache,
} from './model-capabilities-cache';

beforeEach(() => {
  clearModelCapabilitiesCache();
  mockValidateModel.mockReset();
});

describe('model-capabilities-cache', () => {
  it('fetches via validateModel and caches the result per (baseUrl, model)', async () => {
    mockValidateModel.mockResolvedValue({
      isValid: true,
      contextLength: 8192,
      defaultParams: { temperature: 0.8, topP: null, topK: null, numCtx: null, numPredict: null },
    });

    const first = await fetchModelCapabilities('http://localhost:11434', 'llama3');
    const second = await fetchModelCapabilities('http://localhost:11434', 'llama3');

    expect(mockValidateModel).toHaveBeenCalledTimes(1);
    expect(mockValidateModel).toHaveBeenCalledWith('http://localhost:11434', 'llama3');
    expect(first).toEqual({
      contextWindow: 8192,
      modelfileDefaults: {
        temperature: 0.8,
        topP: null,
        topK: null,
        numCtx: null,
        numPredict: null,
      },
    });
    expect(second).toEqual(first);
  });

  it('deduplicates concurrent fetches into a single IPC call', async () => {
    let resolveRpc!: (v: unknown) => void;
    mockValidateModel.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve;
      })
    );

    const a = fetchModelCapabilities('http://localhost:11434', 'llama3');
    const b = fetchModelCapabilities('http://localhost:11434', 'llama3');

    resolveRpc({ isValid: true, contextLength: 4096, defaultParams: null });

    expect(await a).toEqual({ contextWindow: 4096, modelfileDefaults: null });
    expect(await b).toEqual({ contextWindow: 4096, modelfileDefaults: null });
    expect(mockValidateModel).toHaveBeenCalledTimes(1);
  });

  it('keys the cache by both baseUrl and model name', async () => {
    mockValidateModel.mockImplementation((_url: string, model: string) =>
      Promise.resolve({
        isValid: true,
        contextLength: model === 'big' ? 131072 : 4096,
        defaultParams: null,
      })
    );

    await fetchModelCapabilities('http://host-a', 'llama3');
    await fetchModelCapabilities('http://host-b', 'llama3');
    await fetchModelCapabilities('http://host-a', 'big');

    expect(mockValidateModel).toHaveBeenCalledTimes(3);
    expect(getCachedModelCapabilities('http://host-a', 'llama3')?.contextWindow).toBe(4096);
    expect(getCachedModelCapabilities('http://host-b', 'llama3')?.contextWindow).toBe(4096);
    expect(getCachedModelCapabilities('http://host-a', 'big')?.contextWindow).toBe(131072);
  });

  it('caches null facts for invalid models without repeating the RPC', async () => {
    mockValidateModel.mockResolvedValue({
      isValid: false,
      contextLength: null,
      defaultParams: null,
    });

    await fetchModelCapabilities('http://localhost:11434', 'broken-model');
    await fetchModelCapabilities('http://localhost:11434', 'broken-model');

    expect(mockValidateModel).toHaveBeenCalledTimes(1);
    expect(getCachedModelCapabilities('http://localhost:11434', 'broken-model')).toEqual({
      contextWindow: null,
      modelfileDefaults: null,
    });
  });

  it('does not cache rejected fetches so a later call retries', async () => {
    mockValidateModel.mockRejectedValueOnce(new Error('network down'));
    mockValidateModel.mockResolvedValue({
      isValid: true,
      contextLength: 2048,
      defaultParams: null,
    });

    await expect(fetchModelCapabilities('http://localhost:11434', 'llama3')).rejects.toThrow(
      'network down'
    );
    expect(getCachedModelCapabilities('http://localhost:11434', 'llama3')).toBeNull();

    const retry = await fetchModelCapabilities('http://localhost:11434', 'llama3');
    expect(retry).toEqual({ contextWindow: 2048, modelfileDefaults: null });
    expect(mockValidateModel).toHaveBeenCalledTimes(2);
  });

  it('clearModelCapabilitiesCache empties all entries', async () => {
    mockValidateModel.mockResolvedValue({
      isValid: true,
      contextLength: 4096,
      defaultParams: null,
    });
    await fetchModelCapabilities('http://localhost:11434', 'llama3');
    expect(getCachedModelCapabilities('http://localhost:11434', 'llama3')).not.toBeNull();

    clearModelCapabilitiesCache();
    expect(getCachedModelCapabilities('http://localhost:11434', 'llama3')).toBeNull();

    await fetchModelCapabilities('http://localhost:11434', 'llama3');
    expect(mockValidateModel).toHaveBeenCalledTimes(2);
  });
});
