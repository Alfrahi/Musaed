import { describe, it, expect, beforeEach } from 'vitest';
import { useStreamingStore } from './streaming-store';

describe('Streaming Store', () => {
  beforeEach(() => {
    useStreamingStore.setState({
      liveContent: {},
      pendingMetrics: {},
      activeStreams: {},
    });
  });

  it('appends tokens to a new conversation buffer', () => {
    const { appendToken } = useStreamingStore.getState();
    appendToken('conv1', 'Hello');
    appendToken('conv1', ' ');

    const state = useStreamingStore.getState();
    expect(state.liveContent['conv1']).toEqual({ chunks: ['Hello', ' '] });
  });

  it('appends tokens to an existing conversation buffer', () => {
    const { appendToken } = useStreamingStore.getState();
    appendToken('conv1', 'Hello');
    appendToken('conv1', 'World');

    const state = useStreamingStore.getState();
    expect(state.liveContent['conv1']).toEqual({ chunks: ['Hello', 'World'] });
  });

  it('maintains isolated buffers per conversation', () => {
    const { appendToken } = useStreamingStore.getState();
    appendToken('conv1', 'A');
    appendToken('conv2', 'B');

    const state = useStreamingStore.getState();
    expect(state.liveContent['conv1']?.chunks).toEqual(['A']);
    expect(state.liveContent['conv2']?.chunks).toEqual(['B']);
  });

  it('flushes joins chunks into a single string and clears buffer', () => {
    const { appendToken, flushToConversation } = useStreamingStore.getState();
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

  it('setPendingMetrics stores and merges metrics', () => {
    const { setPendingMetrics } = useStreamingStore.getState();
    setPendingMetrics('conv1', { eval_count: 10 });
    setPendingMetrics('conv1', { eval_duration: 100 });

    const state = useStreamingStore.getState();
    expect(state.pendingMetrics['conv1']).toEqual({ eval_count: 10, eval_duration: 100 });
  });

  it('flush includes pending metrics', () => {
    const { appendToken, setPendingMetrics, flushToConversation } = useStreamingStore.getState();
    appendToken('conv1', 'Test');
    setPendingMetrics('conv1', { eval_count: 5, total_duration: 200 });

    const result = flushToConversation('conv1');
    expect(result?.metrics).toEqual({ eval_count: 5, total_duration: 200 });
  });

  it('clearStream removes specific conversation data', () => {
    const { appendToken, setPendingMetrics, clearStream } = useStreamingStore.getState();
    appendToken('conv1', 'data');
    setPendingMetrics('conv1', { eval_count: 1 });
    setPendingMetrics('conv2', { eval_count: 2 });

    clearStream('conv1');

    const state = useStreamingStore.getState();
    expect(state.liveContent['conv1']).toBeUndefined();
    expect(state.pendingMetrics['conv1']).toBeUndefined();
    expect(state.pendingMetrics['conv2']).toBeDefined();
  });

  it('clearAll resets all state', () => {
    const { appendToken, setPendingMetrics, startStream, clearAll } = useStreamingStore.getState();
    appendToken('conv1', 'text');
    setPendingMetrics('conv1', { eval_count: 1 });
    startStream('conv1', 'req123');

    clearAll();

    const state = useStreamingStore.getState();
    expect(state.liveContent).toEqual({});
    expect(state.pendingMetrics).toEqual({});
    expect(state.activeStreams).toEqual({});
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
