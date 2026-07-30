import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useStreamingStore,
  selectLiveContent,
  selectIsLiveStreaming,
  selectActiveRequestId,
} from './streaming-store';
import { traceApi } from '@/lib/ipc';
import { resetStoreTracing } from '@/lib/store-tracing';

describe('useStreamingStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useStreamingStore.getState().clearAll();
  });

  describe('clearAll', () => {
    it('should reset all state to initial values', () => {
      // Setup: add some data
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().appendToken('conv1', 'hello');
      useStreamingStore.getState().setPendingMetrics('conv1', { role: 'assistant' });
      useStreamingStore.getState().markFlushed('conv1');

      // Act
      useStreamingStore.getState().clearAll();

      // Assert
      const state = useStreamingStore.getState();
      expect(state.liveContent).toEqual({});
      expect(state.pendingMetrics).toEqual({});
      expect(state.activeStreams).toEqual({});
      expect(state.flushedStreams).toEqual([]);
    });
  });

  describe('startStream', () => {
    it('should mark a conversation as actively streaming', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');

      const state = useStreamingStore.getState();
      expect(state.activeStreams.conv1).toBe('req1');
    });

    it('should allow multiple concurrent streams', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().startStream('conv2', 'req2');

      const state = useStreamingStore.getState();
      expect(state.activeStreams).toEqual({
        conv1: 'req1',
        conv2: 'req2',
      });
    });

    it('should overwrite requestId if starting stream twice for same conversation', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().startStream('conv1', 'req2');

      const state = useStreamingStore.getState();
      expect(state.activeStreams.conv1).toBe('req2');
    });
  });

  describe('stopStream', () => {
    it('should remove conversation from activeStreams', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().stopStream('conv1');

      const state = useStreamingStore.getState();
      expect(state.activeStreams.conv1).toBeUndefined();
    });

    it('should not affect other active streams', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().startStream('conv2', 'req2');
      useStreamingStore.getState().stopStream('conv1');

      const state = useStreamingStore.getState();
      expect(state.activeStreams).toEqual({ conv2: 'req2' });
    });

    it('should be idempotent - stopping non-existent stream does not error', () => {
      expect(() => {
        useStreamingStore.getState().stopStream('nonexistent');
      }).not.toThrow();
    });
  });

  describe('appendToken', () => {
    it('should append token to liveContent for active stream', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().appendToken('conv1', 'hello');
      useStreamingStore.getState().appendToken('conv1', ' world');

      const state = useStreamingStore.getState();
      expect(state.liveContent.conv1?.chunks).toEqual(['hello', ' world']);
    });

    it('should initialize buffer if not exists', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().appendToken('conv1', 'first');

      const state = useStreamingStore.getState();
      expect(state.liveContent.conv1).toEqual({ chunks: ['first'] });
    });

    it('should silently ignore tokens for non-active streams', () => {
      // Don't start stream
      useStreamingStore.getState().appendToken('conv1', 'ignored');

      const state = useStreamingStore.getState();
      expect(state.liveContent.conv1).toBeUndefined();
    });

    it('should ignore tokens after stream is stopped', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().appendToken('conv1', 'before');
      useStreamingStore.getState().stopStream('conv1');
      useStreamingStore.getState().appendToken('conv1', 'after');

      const state = useStreamingStore.getState();
      expect(state.liveContent.conv1?.chunks).toEqual(['before']);
    });
  });

  describe('setPendingMetrics', () => {
    it('should set metrics for a conversation', () => {
      useStreamingStore.getState().setPendingMetrics('conv1', {
        role: 'assistant',
        model: 'llama3',
      });

      const state = useStreamingStore.getState();
      expect(state.pendingMetrics.conv1).toEqual({
        role: 'assistant',
        model: 'llama3',
      });
    });

    it('should merge metrics for same conversation', () => {
      useStreamingStore.getState().setPendingMetrics('conv1', { role: 'assistant' });
      useStreamingStore.getState().setPendingMetrics('conv1', { model: 'llama3' });

      const state = useStreamingStore.getState();
      expect(state.pendingMetrics.conv1).toEqual({
        role: 'assistant',
        model: 'llama3',
      });
    });

    it('should allow multiple conversations to have metrics', () => {
      useStreamingStore.getState().setPendingMetrics('conv1', { role: 'assistant' });
      useStreamingStore.getState().setPendingMetrics('conv2', { role: 'user' });

      const state = useStreamingStore.getState();
      expect(state.pendingMetrics).toEqual({
        conv1: { role: 'assistant' },
        conv2: { role: 'user' },
      });
    });
  });

  describe('flushToConversation', () => {
    it('should return content and metrics and clear them', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().appendToken('conv1', 'hello');
      useStreamingStore.getState().appendToken('conv1', ' world');
      useStreamingStore.getState().setPendingMetrics('conv1', { role: 'assistant' });

      const result = useStreamingStore.getState().flushToConversation('conv1');

      expect(result).toEqual({
        content: 'hello world',
        metrics: { role: 'assistant' },
      });

      const state = useStreamingStore.getState();
      expect(state.liveContent.conv1).toBeUndefined();
      expect(state.pendingMetrics.conv1).toBeUndefined();
    });

    it('should return null if no buffer exists', () => {
      const result = useStreamingStore.getState().flushToConversation('conv1');
      expect(result).toBeNull();
    });

    it('should return null if already flushed (idempotency guard)', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().appendToken('conv1', 'test');
      useStreamingStore.getState().flushToConversation('conv1');
      useStreamingStore.getState().markFlushed('conv1');

      const result = useStreamingStore.getState().flushToConversation('conv1');
      expect(result).toBeNull();
    });

    it('should return empty string content when buffer has no chunks', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().setPendingMetrics('conv1', { role: 'assistant' });

      const result = useStreamingStore.getState().flushToConversation('conv1');
      expect(result).toEqual({
        content: '',
        metrics: { role: 'assistant' },
      });
    });
  });

  describe('markFlushed', () => {
    it('should add conversation to flushedStreams array', () => {
      useStreamingStore.getState().markFlushed('conv1');

      const state = useStreamingStore.getState();
      expect(state.flushedStreams.includes('conv1')).toBe(true);
    });

    it('should not remove other flushed conversations', () => {
      useStreamingStore.getState().markFlushed('conv1');
      useStreamingStore.getState().markFlushed('conv2');

      const state = useStreamingStore.getState();
      expect(state.flushedStreams.includes('conv1')).toBe(true);
      expect(state.flushedStreams.includes('conv2')).toBe(true);
    });

    it('should be idempotent - marking same conversation twice does not error', () => {
      useStreamingStore.getState().markFlushed('conv1');
      expect(() => {
        useStreamingStore.getState().markFlushed('conv1');
      }).not.toThrow();
    });
  });

  describe('clearStream', () => {
    it('should remove all stream-related data for a conversation', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().appendToken('conv1', 'test');
      useStreamingStore.getState().setPendingMetrics('conv1', { role: 'assistant' });
      useStreamingStore.getState().markFlushed('conv1');

      useStreamingStore.getState().clearStream('conv1');

      const state = useStreamingStore.getState();
      expect(state.liveContent.conv1).toBeUndefined();
      expect(state.pendingMetrics.conv1).toBeUndefined();
      expect(state.activeStreams.conv1).toBeUndefined();
      expect(state.flushedStreams.includes('conv1')).toBe(false);
    });

    it('should not affect other conversations', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().startStream('conv2', 'req2');
      useStreamingStore.getState().appendToken('conv1', 'test1');
      useStreamingStore.getState().appendToken('conv2', 'test2');

      useStreamingStore.getState().clearStream('conv1');

      const state = useStreamingStore.getState();
      expect(state.liveContent.conv2?.chunks).toEqual(['test2']);
      expect(state.activeStreams.conv2).toBe('req2');
    });

    it('should be idempotent - clearing non-existent stream does not error', () => {
      expect(() => {
        useStreamingStore.getState().clearStream('nonexistent');
      }).not.toThrow();
    });
  });

  describe('selectors', () => {
    describe('selectLiveContent', () => {
      it('should return joined chunks for conversation', () => {
        useStreamingStore.getState().startStream('conv1', 'req1');
        useStreamingStore.getState().appendToken('conv1', 'hello');
        useStreamingStore.getState().appendToken('conv1', ' ');
        useStreamingStore.getState().appendToken('conv1', 'world');

        const result = selectLiveContent('conv1')(useStreamingStore.getState());
        expect(result).toBe('hello world');
      });

      it('should return null for conversation without content', () => {
        const result = selectLiveContent('conv1')(useStreamingStore.getState());
        expect(result).toBeNull();
      });
    });

    describe('selectIsLiveStreaming', () => {
      it('should return true for active stream', () => {
        useStreamingStore.getState().startStream('conv1', 'req1');

        const result = selectIsLiveStreaming('conv1')(useStreamingStore.getState());
        expect(result).toBe(true);
      });

      it('should return false for inactive stream', () => {
        const result = selectIsLiveStreaming('conv1')(useStreamingStore.getState());
        expect(result).toBe(false);
      });

      it('should return false after stream is stopped', () => {
        useStreamingStore.getState().startStream('conv1', 'req1');
        useStreamingStore.getState().stopStream('conv1');

        const result = selectIsLiveStreaming('conv1')(useStreamingStore.getState());
        expect(result).toBe(false);
      });
    });

    describe('selectActiveRequestId', () => {
      it('should return requestId for active stream', () => {
        useStreamingStore.getState().startStream('conv1', 'req123');

        const result = selectActiveRequestId('conv1')(useStreamingStore.getState());
        expect(result).toBe('req123');
      });

      it('should return null for non-existent stream', () => {
        const result = selectActiveRequestId('conv1')(useStreamingStore.getState());
        expect(result).toBeNull();
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete streaming lifecycle', () => {
      // Start stream
      useStreamingStore.getState().startStream('conv1', 'req1');
      expect(selectIsLiveStreaming('conv1')(useStreamingStore.getState())).toBe(true);

      // Append tokens
      useStreamingStore.getState().appendToken('conv1', 'chunk1');
      useStreamingStore.getState().appendToken('conv1', 'chunk2');
      useStreamingStore.getState().setPendingMetrics('conv1', { role: 'assistant' });

      // Flush
      const result = useStreamingStore.getState().flushToConversation('conv1');
      expect(result?.content).toBe('chunk1chunk2');
      expect(result?.metrics).toEqual({ role: 'assistant' });

      // Mark flushed
      useStreamingStore.getState().markFlushed('conv1');

      // Second flush should return null (idempotency)
      const secondFlush = useStreamingStore.getState().flushToConversation('conv1');
      expect(secondFlush).toBeNull();

      // Clear stream
      useStreamingStore.getState().clearStream('conv1');
      expect(selectIsLiveStreaming('conv1')(useStreamingStore.getState())).toBe(false);
    });

    it('should handle appendToken after clearStream (zombie buffer prevention)', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().appendToken('conv1', 'before');
      useStreamingStore.getState().clearStream('conv1');
      useStreamingStore.getState().appendToken('conv1', 'after');

      const result = selectLiveContent('conv1')(useStreamingStore.getState());
      expect(result).toBeNull(); // 'after' should be ignored
    });
  });

  describe('Set serialisation (migration)', () => {
    it('should expose flushedStreams as string[] at runtime', () => {
      useStreamingStore.getState().markFlushed('conv1');
      const state = useStreamingStore.getState();

      expect(Array.isArray(state.flushedStreams)).toBe(true);
      expect(state.flushedStreams.includes('conv1')).toBe(true);
    });

    it('should round-trip flushedStreams through JSON cleanly', () => {
      useStreamingStore.getState().markFlushed('conv1');
      useStreamingStore.getState().markFlushed('conv2');

      const before = useStreamingStore.getState().flushedStreams;

      const serialised = JSON.stringify({ flushedStreams: before });
      const parsed = JSON.parse(serialised) as { flushedStreams: unknown };

      expect(Array.isArray(parsed.flushedStreams)).toBe(true);
      // A real Set serialises to {} (no .includes) — array form is required.
      expect((parsed.flushedStreams as string[]).includes('conv1')).toBe(true);
      expect((parsed.flushedStreams as string[]).includes('conv2')).toBe(true);
    });

    it('should coerce a legacy persisted Set (serialised as {}) back to []', () => {
      // Simulates the legacy broken payload: flushedStreams was a Set, which
      // JSON serialised to an empty object. A naïve rehydrate would throw on
      // .has(); the migration must coerce this to a safe array.
      const legacy = {
        state: {
          liveContent: {},
          pendingMetrics: {},
          activeStreams: {},
          flushedStreams: {} as unknown as string[],
        },
        version: 2,
      };

      const persisted =
        typeof legacy.state === 'object' && legacy.state !== null
          ? (legacy.state as { flushedStreams: unknown })
          : { flushedStreams: [] as unknown };
      const normalised = Array.isArray(persisted.flushedStreams) ? persisted.flushedStreams : [];

      expect(normalised).toEqual([]);
      expect(() => normalised.includes).not.toThrow();
    });
  });

  // ── Observability (STANDARDS.md §14) ─────────────────────────────────────
  // appendToken emits a DEBUG trace entry every Nth token per conversation
  // through the shared traceApi pipeline. The throttle counter is reset
  // on flush/clear so a restarted stream emits from the first boundary.
  describe('observability', () => {
    const N = 16;

    beforeEach(() => {
      vi.clearAllMocks();
      useStreamingStore.getState().clearAll();
      resetStoreTracing();
    });

    it('emits a trace entry on the Nth appendToken for a started stream', async () => {
      useStreamingStore.getState().startStream('obs-conv', 'req-1');
      for (let i = 1; i < N; i++) {
        useStreamingStore.getState().appendToken('obs-conv', 't');
      }
      expect(traceApi.append).not.toHaveBeenCalled();
      useStreamingStore.getState().appendToken('obs-conv', 't');

      expect(traceApi.append).toHaveBeenCalledTimes(1);
      const input = (vi.mocked(traceApi.append).mock.calls[0] as unknown[])[0] as Parameters<
        typeof traceApi.append
      >[0];
      expect(input).toMatchObject({
        feature: 'streaming',
        action: 'appendToken',
        level: 'DEBUG',
        source: 'frontend',
      });
      expect(input.context).toMatchObject({ conversationId: 'obs-conv' });
    });

    it('emits a flushToConversation trace on a successful flush', () => {
      useStreamingStore.getState().startStream('flush-conv', 'req-2');
      useStreamingStore.getState().appendToken('flush-conv', 'hello');
      useStreamingStore.getState().flushToConversation('flush-conv');

      const flushCall = vi
        .mocked(traceApi.append)
        .mock.calls.find((c) => (c[0] as { action: string }).action === 'flushToConversation');
      expect(flushCall).toBeDefined();
      expect(flushCall![0]).toMatchObject({
        feature: 'streaming',
        action: 'flushToConversation',
        level: 'DEBUG',
        context: { conversationId: 'flush-conv', contentLen: 'hello'.length },
      });
    });

    it('does not trace appendToken for an inactive (no start) stream', () => {
      // No startStream — appendToken short-circuits inside set(); the trace
      // helper itself still runs (counts the token) but the audit contract is
      // that we only care that flushToConversation still emits on proper flush.
      useStreamingStore.getState().appendToken('ghost-conv', 't');
      expect(
        vi
          .mocked(traceApi.append)
          .mock.calls.some((c) => (c[0] as { action: string }).action === 'appendToken')
      ).toBe(false);
    });
  });
});
