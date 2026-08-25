import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mutable mock state so each test can seed `selectedModel` and `baseUrl` before
// rendering. Selectors return live bindings so re-render picks up new values.
let mockSelectedModel = '';
let mockBaseUrl = 'http://localhost:11434';

const mockValidateModel = vi.fn();

vi.mock('@/lib/ipc', () => ({
  __esModule: true,
  ollamaApi: {
    validateModel: (...args: unknown[]) => mockValidateModel(...args),
  },
}));

vi.mock('@/store/model-store', () => ({
  useSelectedModel: () => mockSelectedModel,
}));

vi.mock('@/store/settings-store', () => ({
  useOllamaUrl: () => mockBaseUrl,
}));

import { useModelContextWindow } from './useModelContextWindow';
import { clearModelCapabilitiesCache } from './model-capabilities-cache';

beforeEach(() => {
  mockSelectedModel = '';
  mockBaseUrl = 'http://localhost:11434';
  mockValidateModel.mockReset();
  mockValidateModel.mockResolvedValue(null);
  clearModelCapabilitiesCache();
});

describe('useModelContextWindow', () => {
  it('shares a single IPC call across multiple mounted consumers', async () => {
    mockSelectedModel = 'llama3';
    mockValidateModel.mockResolvedValue({
      isValid: true,
      modelName: 'llama3',
      details: null,
      contextLength: 8192,
      defaultParams: null,
    });

    const { result } = renderHook(() => [
      useModelContextWindow(),
      useModelContextWindow(),
      useModelContextWindow(),
    ]);

    await waitFor(() => {
      expect(result.current.every((info) => !info.loading)).toBe(true);
    });

    expect(mockValidateModel).toHaveBeenCalledTimes(1);
    expect(result.current.every((info) => info.contextWindow === 8192)).toBe(true);
  });

  it('fetches context_length from validateModel when model is valid', async () => {
    mockSelectedModel = 'llama3';
    mockValidateModel.mockResolvedValue({
      isValid: true,
      modelName: 'llama3',
      details: null,
      contextLength: 8192,
      defaultParams: null,
    });

    const { result } = renderHook(() => useModelContextWindow());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.contextWindow).toBe(8192);
    expect(result.current.defaultParams).toBeNull();
    expect(result.current.error).toBeNull();
    expect(mockValidateModel).toHaveBeenCalledWith('http://localhost:11434', 'llama3');
  });

  it('returns null when contextLength is absent', async () => {
    mockSelectedModel = 'llama3';
    mockValidateModel.mockResolvedValue({
      isValid: true,
      modelName: 'llama3',
      details: null,
      contextLength: null,
      defaultParams: null,
    });

    const { result } = renderHook(() => useModelContextWindow());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.contextWindow).toBeNull();
    expect(result.current.defaultParams).toBeNull();
  });

  it('returns null when validateModel returns null (server error)', async () => {
    mockSelectedModel = 'llama3';
    mockValidateModel.mockResolvedValue(null);

    const { result } = renderHook(() => useModelContextWindow());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.contextWindow).toBeNull();
  });

  it('returns null on fetch rejection', async () => {
    mockSelectedModel = 'llama3';
    mockValidateModel.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useModelContextWindow());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.contextWindow).toBeNull();
  });

  it('returns null without calling validateModel when no model selected', async () => {
    mockSelectedModel = '';
    const { result } = renderHook(() => useModelContextWindow());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.contextWindow).toBeNull();
    expect(result.current.defaultParams).toBeNull();
    expect(mockValidateModel).not.toHaveBeenCalled();
  });

  it('surfaces defaultParams when validateModel returns them', async () => {
    mockSelectedModel = 'llama3';
    mockValidateModel.mockResolvedValue({
      isValid: true,
      modelName: 'llama3',
      details: null,
      contextLength: 8192,
      defaultParams: {
        temperature: 0.8,
        topP: 0.95,
        topK: 64,
        numCtx: 8192,
        numPredict: -1,
      },
    });

    const { result } = renderHook(() => useModelContextWindow());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.defaultParams).not.toBeNull();
    expect(result.current.defaultParams?.temperature).toBe(0.8);
    expect(result.current.defaultParams?.topP).toBe(0.95);
    expect(result.current.defaultParams?.topK).toBe(64);
    expect(result.current.defaultParams?.numCtx).toBe(8192);
    expect(result.current.defaultParams?.numPredict).toBe(-1);
  });

  it('surfaces partial defaultParams (some fields null)', async () => {
    mockSelectedModel = 'llama3';
    mockValidateModel.mockResolvedValue({
      isValid: true,
      modelName: 'llama3',
      details: null,
      contextLength: 4096,
      defaultParams: {
        temperature: 0.5,
        topP: null,
        topK: 40,
        numCtx: null,
        numPredict: 256,
      },
    });

    const { result } = renderHook(() => useModelContextWindow());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.defaultParams?.temperature).toBe(0.5);
    expect(result.current.defaultParams?.topP).toBeNull();
    expect(result.current.defaultParams?.numCtx).toBeNull();
    expect(result.current.defaultParams?.numPredict).toBe(256);
  });

  it('nulls out defaultParams on fetch rejection', async () => {
    mockSelectedModel = 'llama3';
    mockValidateModel.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useModelContextWindow());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.contextWindow).toBeNull();
    expect(result.current.defaultParams).toBeNull();
  });
});
