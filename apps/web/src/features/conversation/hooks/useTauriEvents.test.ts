import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// All mutable state referenced inside vi.mock factories must be wrapped in
// vi.hoisted() so the factory (hoisted above all imports) can close over it.
const { handlerBoxes, mockUnlisten } = vi.hoisted(() => {
  const boxes: Record<string, ((payload: unknown) => void) | null> = {};
  return {
    handlerBoxes: boxes,
    mockUnlisten: vi.fn(),
  };
});

vi.mock('@/lib/ipc', () => ({
  listen: vi.fn((event: string, handler: (payload: unknown) => void) => {
    handlerBoxes[event] = handler;
    return Promise.resolve(mockUnlisten);
  }),
}));

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock('@/lib/i18n', () => ({
  translate: vi.fn((key: string) => key),
}));

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      globalSettings: { language: 'en', ollamaUrl: 'http://localhost:11434' },
    }),
  },
}));

// Use hoisted mutable mocks so individual tests can spy on the store actions.
const { mockAppendToken, mockAppendTokenBulk, mockSetPendingMetrics, mockStreamingState } =
  vi.hoisted(() => ({
    mockAppendToken: vi.fn(),
    mockAppendTokenBulk: vi.fn(),
    mockSetPendingMetrics: vi.fn(),
    mockStreamingState: {
      activeStreams: {},
      liveContent: {},
    },
  }));

vi.mock('@/store/streaming-store', () => ({
  useStreamingStore: {
    getState: () => ({
      activeStreams: mockStreamingState.activeStreams,
      liveContent: mockStreamingState.liveContent,
      appendToken: mockAppendToken,
      appendTokenBulk: mockAppendTokenBulk,
      setPendingMetrics: mockSetPendingMetrics,
    }),
  },
}));

// Use the real token-coalescer module so the rAF batching and drain logic
// are exercised. jsdom provides requestAnimationFrame/cancelAnimationFrame.
vi.mock('@/store/coordination', () => ({
  stopStream: vi.fn(),
}));

vi.mock('@/store/message-store', () => ({
  useMessageStore: {
    getState: () => ({
      messages: {},
    }),
  },
}));

vi.mock('./useAutoTitle', () => ({
  triggerAutoTitle: vi.fn(),
}));

vi.mock('@/features/conversation/utils/message-persistence', () => ({
  persistMessage: vi.fn().mockResolvedValue({ success: true, retries: 0 }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import { useTauriEvents } from './useTauriEvents';
import { bufferToken, drainPendingTokenBatch, setBulkFlush } from '@/lib/token-coalescer';

/**
 * Minimal renderHook helper using @testing-library/react.
 */
function renderHook<Result>(hook: () => Result) {
  const ref: { current: Result | null } = { current: null };
  const TestComponent = () => {
    ref.current = hook();
    return null;
  };
  render(React.createElement(TestComponent));
  return {
    result: {
      get current() {
        return ref.current!;
      },
    },
  };
}

/** Helper: build a token payload shape matching the OllamaTokenSchema. */
function makeToken(opts: {
  requestId: string;
  content: string;
  done?: boolean;
  evalCount?: number;
  promptEvalCount?: number;
  evalDuration?: number;
  totalDuration?: number;
}) {
  return {
    requestId: opts.requestId,
    message: { content: opts.content, role: 'assistant' as const },
    done: opts.done ?? false,
    evalCount: opts.evalCount,
    promptEvalCount: opts.promptEvalCount,
    evalDuration: opts.evalDuration,
    totalDuration: opts.totalDuration,
  };
}

describe('useTauriEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(handlerBoxes).forEach((k) => {
      handlerBoxes[k] = null;
    });
    mockStreamingState.activeStreams = {};
    mockStreamingState.liveContent = {};
    // Reset the coalescer's internal state between tests.
    drainPendingTokenBatch();
    // Register the bulk flush so the coalescer pushes into the mock store.
    setBulkFlush((convId, text, reqId) => {
      mockAppendTokenBulk(convId, text, reqId);
    });
  });

  it('registers event listeners on mount', async () => {
    renderHook(() => useTauriEvents());

    await waitFor(() => {
      expect(handlerBoxes['ollama-error']).not.toBeNull();
    });
    expect(handlerBoxes['ollama-token']).not.toBeNull();
  });

  describe('rAF token coalescing', () => {
    it('buffers multiple tokens and flushes them in a single appendTokenBulk call on rAF', async () => {
      // Simulate an active stream
      mockStreamingState.activeStreams = { 'conv-1': 'req-1' };
      mockStreamingState.liveContent = { 'conv-1': {} };

      renderHook(() => useTauriEvents());
      await waitFor(() => {
        expect(handlerBoxes['ollama-token']).not.toBeNull();
      });

      vi.mocked(mockAppendTokenBulk).mockClear();

      // Send 5 tokens rapidly — they should all be buffered, not sent
      // individually to the store.
      const handler = handlerBoxes['ollama-token']!;
      handler(makeToken({ requestId: 'req-1', content: 'Hello' }));
      handler(makeToken({ requestId: 'req-1', content: ' ' }));
      handler(makeToken({ requestId: 'req-1', content: 'world' }));
      handler(makeToken({ requestId: 'req-1', content: '!' }));
      handler(makeToken({ requestId: 'req-1', content: '!!' }));

      // The bulk action should NOT have been called yet (rAF hasn't fired).
      // In jsdom, requestAnimationFrame fires asynchronously.
      expect(mockAppendTokenBulk).not.toHaveBeenCalled();

      // Wait for the rAF callback to fire.
      await waitFor(() => {
        expect(mockAppendTokenBulk).toHaveBeenCalledTimes(1);
      });

      // All 5 tokens should arrive in a single concatenated string.
      expect(mockAppendTokenBulk).toHaveBeenCalledWith('conv-1', 'Hello world!!!', 'req-1');
    });

    it('does not call appendToken (single-token) — only appendTokenBulk', async () => {
      mockStreamingState.activeStreams = { 'conv-1': 'req-1' };
      mockStreamingState.liveContent = { 'conv-1': {} };

      renderHook(() => useTauriEvents());
      await waitFor(() => {
        expect(handlerBoxes['ollama-token']).not.toBeNull();
      });

      const handler = handlerBoxes['ollama-token']!;
      handler(makeToken({ requestId: 'req-1', content: 'a' }));
      handler(makeToken({ requestId: 'req-1', content: 'b' }));

      await waitFor(() => {
        expect(mockAppendTokenBulk).toHaveBeenCalled();
      });

      // The old per-token path must not be used.
      expect(mockAppendToken).not.toHaveBeenCalled();
    });

    it('coalesces tokens across multiple conversations into separate batches', async () => {
      mockStreamingState.activeStreams = { 'conv-1': 'req-1', 'conv-2': 'req-2' };
      mockStreamingState.liveContent = { 'conv-1': {}, 'conv-2': {} };

      renderHook(() => useTauriEvents());
      await waitFor(() => {
        expect(handlerBoxes['ollama-token']).not.toBeNull();
      });

      vi.mocked(mockAppendTokenBulk).mockClear();

      const handler = handlerBoxes['ollama-token']!;
      handler(makeToken({ requestId: 'req-1', content: 'A' }));
      handler(makeToken({ requestId: 'req-2', content: 'B' }));
      handler(makeToken({ requestId: 'req-1', content: 'C' }));

      await waitFor(() => {
        expect(mockAppendTokenBulk).toHaveBeenCalledTimes(2);
      });

      expect(mockAppendTokenBulk).toHaveBeenCalledWith('conv-1', 'AC', 'req-1');
      expect(mockAppendTokenBulk).toHaveBeenCalledWith('conv-2', 'B', 'req-2');
    });

    it('drainPendingTokenBatch flushes buffered tokens synchronously without waiting for rAF', () => {
      // Use the coalescer directly (not via the Tauri event handler) to
      // verify the drain function. We need an active stream so the handler
      // lookup works, but we can also just call bufferToken directly.
      mockStreamingState.activeStreams = { 'conv-1': 'req-1' };

      vi.mocked(mockAppendTokenBulk).mockClear();

      // Buffer tokens without waiting for rAF.
      bufferToken('conv-1', 'sync', 'req-1');
      bufferToken('conv-1', '-flush', 'req-1');

      // Nothing flushed yet (rAF not fired).
      expect(mockAppendTokenBulk).not.toHaveBeenCalled();

      // Drain synchronously.
      drainPendingTokenBatch();

      expect(mockAppendTokenBulk).toHaveBeenCalledTimes(1);
      expect(mockAppendTokenBulk).toHaveBeenCalledWith('conv-1', 'sync-flush', 'req-1');
    });

    it('drainPendingTokenBatch is idempotent — calling twice does not double-flush', () => {
      mockStreamingState.activeStreams = { 'conv-1': 'req-1' };

      vi.mocked(mockAppendTokenBulk).mockClear();

      bufferToken('conv-1', 'once', 'req-1');
      drainPendingTokenBatch();

      expect(mockAppendTokenBulk).toHaveBeenCalledTimes(1);

      // Second drain — nothing buffered, no additional call.
      drainPendingTokenBatch();
      expect(mockAppendTokenBulk).toHaveBeenCalledTimes(1);
    });

    it('calls setPendingMetrics synchronously when token carries metrics', async () => {
      mockStreamingState.activeStreams = { 'conv-1': 'req-1' };
      mockStreamingState.liveContent = { 'conv-1': {} };

      renderHook(() => useTauriEvents());
      await waitFor(() => {
        expect(handlerBoxes['ollama-token']).not.toBeNull();
      });

      vi.mocked(mockSetPendingMetrics).mockClear();

      const handler = handlerBoxes['ollama-token']!;
      handler(
        makeToken({
          requestId: 'req-1',
          content: 'X',
          evalCount: 10,
          promptEvalCount: 42,
          evalDuration: 5000,
          totalDuration: 20000,
        })
      );

      // setPendingMetrics is synchronous (not buffered through rAF).
      expect(mockSetPendingMetrics).toHaveBeenCalledTimes(1);
      expect(mockSetPendingMetrics).toHaveBeenCalledWith('conv-1', {
        evalCount: 10,
        promptEvalCount: 42,
        evalDuration: 5000,
        totalDuration: 20000,
      });
    });
  });
});
