import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { mockAllDependencies, mockIpc, mockStores } from './shared/mocks';
import type { Message } from '@musaed/contracts';

// Mock `useModelContextWindow` so we can control the context window
// per-test without relying on the async validateModel resolution.
vi.mock('@/features/library', () => ({
  useModelContextWindow: vi.fn(),
}));

import { useModelContextWindow } from '@/features/library';
import { useTokenUsage } from './useTokenUsage';

const mockUseModelContextWindow = vi.mocked(useModelContextWindow);

// The mock store inits `messages` as `{ conv1: [] }` (inferred `never[]`).
// Cast through a typed accessor so we can assign `Message[]` values.
const messagesByConv = mockStores.messageStore.messages as unknown as Record<string, Message[]>;

beforeEach(() => {
  mockAllDependencies();
  vi.clearAllMocks();
  mockIpc.ollamaApi.validateModel.mockResolvedValue(null);
  messagesByConv.conv1 = [];
  // Default: no model context window → falls back to numCtx (4096)
  mockUseModelContextWindow.mockReturnValue({
    contextWindow: null,
    defaultParams: null,
    loading: false,
    error: null,
  });
});

describe('useTokenUsage', () => {
  it('returns zero usage with numCtx fallback when no messages', async () => {
    const { result } = renderHook(() => useTokenUsage());

    expect(result.current.usedTokens).toBe(0);
    expect(result.current.contextWindow).toBe(4096);
    expect(result.current.hasData).toBe(false);
  });

  it('uses model context_length when available (8192) over numCtx (4096)', async () => {
    mockUseModelContextWindow.mockReturnValue({
      contextWindow: 8192,
      defaultParams: null,
      loading: false,
      error: null,
    });

    const { result } = renderHook(() => useTokenUsage());

    expect(result.current.usedTokens).toBe(0);
    expect(result.current.contextWindow).toBe(8192);
    expect(result.current.hasData).toBe(false);
  });

  it('falls back to numCtx when model context_length is unavailable', async () => {
    mockUseModelContextWindow.mockReturnValue({
      contextWindow: null,
      defaultParams: null,
      loading: false,
      error: null,
    });

    const { result } = renderHook(() => useTokenUsage());

    expect(result.current.contextWindow).toBe(4096);
  });

  it('falls back to numCtx when validateModel fails', async () => {
    mockUseModelContextWindow.mockReturnValue({
      contextWindow: null,
      defaultParams: null,
      loading: false,
      error: 'offline',
    });

    const { result } = renderHook(() => useTokenUsage());

    expect(result.current.contextWindow).toBe(4096);
  });

  it('uses promptEvalCount only as the numerator (excludes evalCount)', async () => {
    mockUseModelContextWindow.mockReturnValue({
      contextWindow: 8192,
      defaultParams: null,
      loading: false,
      error: null,
    });

    messagesByConv.conv1 = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'response',
        timestamp: 1,
        model: 'llama3',
        requestId: 'req-1',
        promptEvalCount: 3000,
        evalCount: 500,
        evalDuration: 1000,
        totalDuration: 2000,
      },
    ];

    const { result } = renderHook(() => useTokenUsage());

    // promptEvalCount only — completion tokens are NOT added
    expect(result.current.usedTokens).toBe(3000);
    expect(result.current.contextWindow).toBe(8192);
    expect(result.current.percentage).toBe(37);
    expect(result.current.hasData).toBe(true);
  });

  it('returns hasData false when promptEvalCount is zero even if evalCount > 0', async () => {
    mockUseModelContextWindow.mockReturnValue({
      contextWindow: 8192,
      defaultParams: null,
      loading: false,
      error: null,
    });

    messagesByConv.conv1 = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'response',
        timestamp: 1,
        model: 'llama3',
        requestId: 'req-1',
        promptEvalCount: 0,
        evalCount: 500,
      },
    ];

    const { result } = renderHook(() => useTokenUsage());

    expect(result.current.hasData).toBe(false);
    expect(result.current.usedTokens).toBe(0);
  });

  it('guards against contextWindow === 0 to avoid division by zero', async () => {
    mockUseModelContextWindow.mockReturnValue({
      contextWindow: 0,
      defaultParams: null,
      loading: false,
      error: null,
    });

    messagesByConv.conv1 = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'response',
        timestamp: 1,
        model: 'llama3',
        requestId: 'req-1',
        promptEvalCount: 3000,
        evalCount: 500,
      },
    ];

    const { result } = renderHook(() => useTokenUsage());

    expect(result.current.hasData).toBe(false);
    expect(result.current.usedTokens).toBe(0);
    expect(result.current.contextWindow).toBe(0);
    expect(result.current.percentage).toBe(0);
  });

  it('uses the last assistant message for promptEvalCount', async () => {
    mockUseModelContextWindow.mockReturnValue({
      contextWindow: 8192,
      defaultParams: null,
      loading: false,
      error: null,
    });

    messagesByConv.conv1 = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'first response',
        timestamp: 1,
        model: 'llama3',
        requestId: 'req-1',
        promptEvalCount: 1000,
        evalCount: 200,
      },
      {
        id: 'msg-2',
        role: 'user',
        content: 'follow up',
        timestamp: 2,
        requestId: 'req-2',
      },
      {
        id: 'msg-3',
        role: 'assistant',
        content: 'second response',
        timestamp: 3,
        model: 'llama3',
        requestId: 'req-3',
        promptEvalCount: 5000,
        evalCount: 300,
      },
    ];

    const { result } = renderHook(() => useTokenUsage());

    // Uses the latest assistant's promptEvalCount, not the first
    expect(result.current.usedTokens).toBe(5000);
    expect(result.current.percentage).toBe(61);
    expect(result.current.hasData).toBe(true);
  });
});
