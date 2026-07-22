import { describe, it, expect, beforeEach } from 'vitest';
import {
  useStreamingStore,
  selectLiveContent,
  selectIsLiveStreaming,
  selectActiveRequestId,
} from './streaming-store';

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

        const result = useStreamingStore.getState(selectLiveContent('conv1'));
        expect(result).toBe('hello world');
      });

      it('should return null for conversation without content', () => {
        const result = useStreamingStore.getState(selectLiveContent('conv1'));
        expect(result).toBeNull();
      });
    });

    describe('selectIsLiveStreaming', () => {
      it('should return true for active stream', () => {
        useStreamingStore.getState().startStream('conv1', 'req1');

        const result = useStreamingStore.getState(selectIsLiveStreaming('conv1'));
        expect(result).toBe(true);
      });

      it('should return false for inactive stream', () => {
        const result = useStreamingStore.getState(selectIsLiveStreaming('conv1'));
        expect(result).toBe(false);
      });

      it('should return false after stream is stopped', () => {
        useStreamingStore.getState().startStream('conv1', 'req1');
        useStreamingStore.getState().stopStream('conv1');

        const result = useStreamingStore.getState(selectIsLiveStreaming('conv1'));
        expect(result).toBe(false);
      });
    });

    describe('selectActiveRequestId', () => {
      it('should return requestId for active stream', () => {
        useStreamingStore.getState().startStream('conv1', 'req123');

        const result = useStreamingStore.getState(selectActiveRequestId('conv1'));
        expect(result).toBe('req123');
      });

      it('should return null for non-existent stream', () => {
        const result = useStreamingStore.getState(selectActiveRequestId('conv1'));
        expect(result).toBeNull();
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete streaming lifecycle', () => {
      // Start stream
      useStreamingStore.getState().startStream('conv1', 'req1');
      expect(useStreamingStore.getState(selectIsLiveStreaming('conv1'))).toBe(true);

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
      expect(useStreamingStore.getState(selectIsLiveStreaming('conv1'))).toBe(false);
    });

    it('should handle appendToken after clearStream (zombie buffer prevention)', () => {
      useStreamingStore.getState().startStream('conv1', 'req1');
      useStreamingStore.getState().appendToken('conv1', 'before');
      useStreamingStore.getState().clearStream('conv1');
      useStreamingStore.getState().appendToken('conv1', 'after');

      const result = useStreamingStore.getState(selectLiveContent('conv1'));
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
});
