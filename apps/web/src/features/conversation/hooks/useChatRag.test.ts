// Tests for useChatRag — RAG citation mapping for the send pipeline.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from './useChatActions/shared/setup';
import { mockAllDependencies } from './useChatActions/shared/mocks';

// Mock the rag feature hook so we can drive assembleContext without its store deps.
const assembleContextMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/rag', () => ({
  useRagAssembleContext: () => ({ assembleContext: assembleContextMock, activeProject: null }),
}));

import { useChatRag } from './useChatRag';

beforeEach(() => {
  mockAllDependencies();
  vi.clearAllMocks();
});

describe('useChatRag', () => {
  it('maps RAG citations to the chat ragSources shape', async () => {
    assembleContextMock.mockResolvedValue({
      assembled_context: 'ctx',
      citations: [
        { filePath: '/a.ts', startLine: 1, endLine: 10, language: 'typescript' },
        { filePath: '/b.md', startLine: 5, endLine: 8, language: undefined },
      ],
      token_count: 2,
    });

    const { result } = renderHook(() => useChatRag());
    const { ragSources } = await act(() => result.current.assembleChatRag('query'));

    expect(ragSources).toEqual([
      { filePath: '/a.ts', startLine: 1, endLine: 10, language: 'typescript' },
      { filePath: '/b.md', startLine: 5, endLine: 8, language: undefined },
    ]);
  });

  it('returns undefined ragSources when RAG returns null (no active project)', async () => {
    assembleContextMock.mockResolvedValue(null);

    const { result } = renderHook(() => useChatRag());
    const { ragSources } = await act(() => result.current.assembleChatRag('query'));

    expect(ragSources).toBeUndefined();
  });

  it('propagates RAG assembly failures (swallowed by rag feature hook)', async () => {
    // useChatRag does not itself swallow — useRagAssembleContext does.
    assembleContextMock.mockResolvedValue(null);

    const { result } = renderHook(() => useChatRag());
    const { ragSources } = await act(() => result.current.assembleChatRag('query'));

    expect(ragSources).toBeUndefined();
  });
});
