import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { mockAllDependencies, mockIpc } from './shared/mocks';

import { useTokenUsage } from './useTokenUsage';

beforeEach(() => {
  mockAllDependencies();
  vi.clearAllMocks();
  mockIpc.ollamaApi.validateModel.mockResolvedValue(null);
});

describe('useTokenUsage', () => {
  it('returns zero usage with numCtx fallback when no messages', async () => {
    const { result } = renderHook(() => useTokenUsage());

    await waitFor(() => {
      expect(result.current.contextWindow).toBe(4096);
    });

    expect(result.current.usedTokens).toBe(0);
    expect(result.current.contextWindow).toBe(4096);
    expect(result.current.hasData).toBe(false);
  });

  it('uses model context_length when available (8192) over numCtx (4096)', async () => {
    mockIpc.ollamaApi.validateModel.mockResolvedValue({
      isValid: true,
      modelName: 'llama3',
      details: null,
      contextLength: 8192,
    });

    const { result } = renderHook(() => useTokenUsage());

    // Wait for the async context-window fetch to settle.
    await waitFor(() => {
      expect(result.current.contextWindow).toBe(8192);
    });

    expect(result.current.usedTokens).toBe(0);
    expect(result.current.hasData).toBe(false);
  });

  it('falls back to numCtx when model context_length is unavailable', async () => {
    mockIpc.ollamaApi.validateModel.mockResolvedValue({
      isValid: true,
      modelName: 'llama3',
      details: null,
      contextLength: null,
    });

    const { result } = renderHook(() => useTokenUsage());

    await waitFor(() => {
      expect(result.current.contextWindow).toBe(4096);
    });
  });

  it('falls back to numCtx when validateModel fails', async () => {
    mockIpc.ollamaApi.validateModel.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useTokenUsage());

    await waitFor(() => {
      expect(result.current.contextWindow).toBe(4096);
    });
  });
});
