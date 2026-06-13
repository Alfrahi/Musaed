import { describe, it, expect, beforeEach } from 'vitest';
import { useStreamingStore } from './streaming-store';

describe('Streaming Store', () => {
  beforeEach(() => {
    useStreamingStore.setState({
      liveContent: {},
      pendingMetrics: {},
      activeStreams: {},
      flushedStreams: new Set(),
    });
  });

  it('appends tokens to a new conversation buffer', () => {
    const { appendToken, startStream } = useStreamingStore.getState();
    startStream('conv1', 'req1');
    appendToken('conv1', 'Hello');
    appendToken('conv1', ' ');

    const state = useStreamingStore.getState();
    expect(state.liveContent['conv1']).toEqual({ chunks: ['Hello', ' '] });
  });

  it('appends tokens to an existing conversation buffer', () => {
    const { appendToken, startStream } = useStreamingStore.getState();
    startStream('conv1', 'req1');
    appendToken('conv1', 'Hello');
    appendToken('conv1', 'World');

    const state = useStreamingStore.getState();
    expect(state.liveContent['conv1']).toEqual({ chunks: ['Hello', 'World'] });
  });

  it('maintains isolated buffers per conversation', () => {
    const { appendToken, startStream } = useStreamingStore.getState();
    startStream('conv1', 'req1');
    startStream('conv2', 'req2');
    appendToken('conv1', 'A');
    appendToken('conv2', 'B');

    const state = useStreamingStore.getState();
    expect(state.liveContent['conv1']?.chunks).toEqual(['A']);
    expect(state.liveContent['conv2']?.chunks).toEqual(['B']);
  });

  it('flushes joins chunks into a single string and clears buffer', () => {
    const { appendToken, flushToConversation, startStream } = useStreamingStore.getState();
    startStream('conv1', 'req1');
    appendToken('conv1', 'Hello');
    appendToken('conv1', ' ');
    appendToken('conv1', 'World');

    const result = flushToConversation('conv1');
    expect(result).toEqual({ content: 'Hello World', metrics: {} });

    const state = useStreamingStore.getState();
    expect(state.liveContent['conv1']).toBeUndefined();
  });

  it('flush returns null when no buffer exists', () => {
    const { flushToConversation } = useStreamingStore.getState();
    const result = flushToConversation('nonexistent');
    expect(result).toBeNull();
  });

  it('flushToConversation is idempotent — second call returns null', () => {
    const { appendToken, flushToConversation, markFlushed, startStream } =
      useStreamingStore.getState();

    // First flush should succeed
    startStream('conv1', 'req1');
    appendToken('conv1', 'Hello');
    const result1 = flushToConversation('conv1');
    expect(result1).toEqual({ content: 'Hello', metrics: {} });

    // Mark as flushed (simulating what flushAndStop does)
    markFlushed('conv1');

    // Second flush should return null even with new data
    appendToken('conv1', 'World');
    const result2 = flushToConversation('conv1');
    expect(result2).toBeNull();
  });

  it('setPendingMetrics stores and merges metrics', () => {
    const { setPendingMetrics } = useStreamingStore.getState();
    setPendingMetrics('conv1', { evalCount: 10 });
    setPendingMetrics('conv1', { evalDuration: 100 });

    const state = useStreamingStore.getState();
    expect(state.pendingMetrics['conv1']).toEqual({ evalCount: 10, evalDuration: 100 });
  });

  it('flush includes pending metrics', () => {
    const { appendToken, setPendingMetrics, flushToConversation, startStream } =
      useStreamingStore.getState();
    startStream('conv1', 'req1');
    appendToken('conv1', 'Test');
    setPendingMetrics('conv1', { evalCount: 5, totalDuration: 200 });

    const result = flushToConversation('conv1');
    expect(result?.metrics).toEqual({ evalCount: 5, totalDuration: 200 });
  });

  it('clearStream removes specific conversation data', () => {
    const { appendToken, setPendingMetrics, clearStream, startStream } =
      useStreamingStore.getState();

    // conv1 needs to be actively streaming to accept tokens
    startStream('conv1', 'req1');
    appendToken('conv1', 'data');
    setPendingMetrics('conv1', { evalCount: 1 });
    setPendingMetrics('conv2', { evalCount: 2 });

    clearStream('conv1');

    const state = useStreamingStore.getState();
    expect(state.liveContent['conv1']).toBeUndefined();
    expect(state.pendingMetrics['conv1']).toBeUndefined();
    expect(state.pendingMetrics['conv2']).toBeDefined();
  });

  it('clearAll resets all state', () => {
    const { appendToken, setPendingMetrics, startStream, clearAll } = useStreamingStore.getState();
    startStream('conv1', 'req123');
    appendToken('conv1', 'text');
    setPendingMetrics('conv1', { evalCount: 1 });

    clearAll();

    const state = useStreamingStore.getState();
    expect(state.liveContent).toEqual({});
    expect(state.pendingMetrics).toEqual({});
    expect(state.activeStreams).toEqual({});
  });

  it('appendToken rejects tokens for non-streaming conversations (zombie buffer prevention)', () => {
    const { appendToken, startStream, clearStream } = useStreamingStore.getState();

    // Start streaming
    startStream('conv1', 'req1');
    appendToken('conv1', 'Hello');

    // Clear the stream (simulating stop/clear scenario)
    clearStream('conv1');

    // Attempted token append after clear should be rejected (no zombie buffer)
    appendToken('conv1', 'World');

    const state = useStreamingStore.getState();
    expect(state.liveContent['conv1']).toBeUndefined();
    expect(state.activeStreams['conv1']).toBeUndefined();
  });

  it('selectLiveContent returns joined string or null', () => {
    const selectLiveContent = (convId: string) => (state: any) =>
      state.liveContent[convId]?.chunks.join('') ?? null;

    // Define state with buffer
    const state = {
      liveContent: { conv1: { chunks: ['Hello', 'World'] } },
    };
    expect(selectLiveContent('conv1')(state)).toBe('HelloWorld');
    expect(selectLiveContent('missing')(state)).toBeNull();
  });
});
