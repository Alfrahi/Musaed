import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { mockAllDependencies, mockIpc } from './shared/mocks';

import { useModelContextWindow } from './useModelContextWindow';

beforeEach(() => {
  mockAllDependencies();
  vi.clearAllMocks();
  mockIpc.ollamaApi.validateModel.mockResolvedValue(null);
});

describe('useModelContextWindow', () => {
  it('fetches context_length from validateModel when model is valid', async () => {
    mockIpc.ollamaApi.validateModel.mockResolvedValue({
      isValid: true,
      modelName: 'llama3',
      details: null,
      contextLength: 8192,
    });

    const { result } = renderHook(() => useModelContextWindow());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.contextWindow).toBe(8192);
    expect(result.current.error).toBeNull();
    expect(mockIpc.ollamaApi.validateModel).toHaveBeenCalledWith(
      'http://localhost:11434',
      'llama3'
    );
  });

  it('returns null when contextLength is absent', async () => {
    mockIpc.ollamaApi.validateModel.mockResolvedValue({
      isValid: true,
      modelName: 'llama3',
      details: null,
      contextLength: null,
    });

    const { result } = renderHook(() => useModelContextWindow());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.contextWindow).toBeNull();
  });

  it('returns null when validateModel returns null (server error)', async () => {
    mockIpc.ollamaApi.validateModel.mockResolvedValue(null);

    const { result } = renderHook(() => useModelContextWindow());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.contextWindow).toBeNull();
  });

  it('returns null on fetch rejection', async () => {
    mockIpc.ollamaApi.validateModel.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useModelContextWindow());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.contextWindow).toBeNull();
  });
});
