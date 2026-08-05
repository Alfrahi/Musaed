// Tests for useMessageSearch — debounced search with stale-response guard.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── IPC mock ──────────────────────────────────────────────────────────────
const searchMessagesMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/ipc', () => ({
  conversationApi: {
    searchMessages: searchMessagesMock,
  },
}));

// ── Type import (after mock is hoisted) ───────────────────────────────────
import { useMessageSearch } from './useMessageSearch';

// ── Helpers ───────────────────────────────────────────────────────────────
function makeResult(
  id: string,
  conversationId: string,
  conversationTitle: string,
  content: string,
  role: 'user' | 'assistant' = 'assistant'
) {
  return {
    message: {
      id,
      role,
      content,
      timestamp: Date.now(),
      model: 'test-model',
      done: true,
      requestId: 'req-' + id,
      images: undefined,
      evalCount: 0,
      promptEvalCount: 0,
      totalDuration: 0,
      evalDuration: 0,
      ragSources: undefined,
      error: undefined,
    },
    conversationId,
    conversationTitle,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  searchMessagesMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useMessageSearch', () => {
  it('returns initial state with empty query and no results', () => {
    const { result } = renderHook(() => useMessageSearch());
    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('clears results immediately when query is set to empty', () => {
    const { result } = renderHook(() => useMessageSearch());

    act(() => {
      result.current.setQuery('');
    });

    expect(result.current.results).toEqual([]);
    expect(result.current.isSearching).toBe(false);
    expect(searchMessagesMock).not.toHaveBeenCalled();
  });

  it('sets isSearching and fires debounced search after 300ms', async () => {
    searchMessagesMock.mockResolvedValue([]);
    const { result } = renderHook(() => useMessageSearch());

    act(() => {
      result.current.setQuery('hello');
    });

    // Right after setQuery — searching started, no IPC call yet
    expect(result.current.isSearching).toBe(true);
    expect(searchMessagesMock).not.toHaveBeenCalled();

    // Advance timers to fire the debounce
    await act(async () => {
      vi.advanceTimersByTimeAsync(300);
    });

    expect(searchMessagesMock).toHaveBeenCalledWith('hello', 50);
    expect(result.current.isSearching).toBe(false);
  });

  it('populates results when search resolves', async () => {
    const mockResults = [makeResult('m1', 'c1', 'Chat 1', 'hello world')];
    searchMessagesMock.mockResolvedValue(mockResults);

    const { result } = renderHook(() => useMessageSearch());

    act(() => {
      result.current.setQuery('hello');
    });

    await act(async () => {
      vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.results).toEqual(mockResults);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets error message when search rejects', async () => {
    searchMessagesMock.mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => useMessageSearch());

    act(() => {
      result.current.setQuery('fail');
    });

    await act(async () => {
      vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.error).toBe('Network failure');
    expect(result.current.results).toEqual([]);
    expect(result.current.isSearching).toBe(false);
  });

  it('cancels pending debounce when query changes rapidly', async () => {
    searchMessagesMock.mockResolvedValue([]);
    const { result } = renderHook(() => useMessageSearch());

    act(() => {
      result.current.setQuery('first');
    });
    act(() => {
      vi.advanceTimersByTime(150); // halfway through first debounce
    });
    act(() => {
      result.current.setQuery('second'); // should cancel first
    });

    expect(searchMessagesMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTimeAsync(300);
    });

    // Only the second query should fire
    expect(searchMessagesMock).toHaveBeenCalledTimes(1);
    expect(searchMessagesMock).toHaveBeenCalledWith('second', 50);
  });

  it('guards against stale responses — newer query supersedes older one', async () => {
    // First query resolves slowly, second query resolves faster.
    // Without the request-id guard, the slower first response would
    // overwrite the second one when it finally lands.
    const slowResults = [makeResult('m-slow', 'c1', 'Slow', 'slow content')];
    const fastResults = [makeResult('m-fast', 'c2', 'Fast', 'fast content')];

    let resolveSlow: (v: typeof slowResults) => void = () => {};
    const slowPromise = new Promise<typeof slowResults>((r) => {
      resolveSlow = r;
    });

    searchMessagesMock
      .mockReturnValueOnce(slowPromise) // slow
      .mockResolvedValueOnce(fastResults); // fast

    const { result } = renderHook(() => useMessageSearch());

    // Fire first query — slow response pending
    act(() => {
      result.current.setQuery('slow');
    });
    await act(async () => {
      vi.advanceTimersByTimeAsync(300);
    });
    expect(searchMessagesMock).toHaveBeenCalledWith('slow', 50);

    // Fire second query — cancels any stale state effect
    act(() => {
      result.current.setQuery('fast');
    });
    await act(async () => {
      vi.advanceTimersByTimeAsync(300);
    });
    expect(searchMessagesMock).toHaveBeenCalledWith('fast', 50);

    // Fast response arrived first — results are the fast ones
    expect(result.current.results).toEqual(fastResults);

    // Now the slow response finally resolves
    await act(async () => {
      resolveSlow(slowResults);
    });

    // Stale guard should have kicked in — slow results must NOT overwrite
    expect(result.current.results).toEqual(fastResults);
  });

  it('trims the query before sending to backend', async () => {
    searchMessagesMock.mockResolvedValue([]);
    const { result } = renderHook(() => useMessageSearch());

    act(() => {
      result.current.setQuery('  spaced  ');
    });

    await act(async () => {
      vi.advanceTimersByTimeAsync(300);
    });

    expect(searchMessagesMock).toHaveBeenCalledWith('spaced', 50);
  });
});
