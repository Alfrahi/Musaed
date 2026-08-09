// Updated coordination tests after removing persistence from conversation and streaming stores
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUIStore } from '@/store/ui-store';
import { useSettingsStore } from '@/store/settings-store';
import { useRagStore } from '@/store/rag-store';
import { useModelStore } from '@/store/model-store';
import { useModelParamsStore } from '@/store/model-params-store';
import { useStreamingStore } from '@/store/streaming-store';
import { useMessageStore } from '@/store/message-store';
import { registerHydrationCoordination, stopStream } from './coordination';

beforeEach(() => {
  (window as any).__TAURI_INTERNALS__ = {};
  useUIStore.setState({
    isStreaming: false,
    isInitialized: false,
    isHydrated: false,
    isOllamaConnected: false,
    errorMessage: null,
    activeModal: null,
    _pendingRehydrations: 0,
  });
});

describe('registerHydrationCoordination', () => {
  it('initializes the pending rehydrations counter to 4 (one per persisted store)', () => {
    registerHydrationCoordination();
    expect(useUIStore.getState()._pendingRehydrations).toBe(4);
  });

  it('triggers rehydrate on every persisted store (settings, rag, model, model-params)', () => {
    const settingsSpy = vi.spyOn(useSettingsStore.persist, 'rehydrate');
    const ragSpy = vi.spyOn(useRagStore.persist, 'rehydrate');
    const modelSpy = vi.spyOn(useModelStore.persist, 'rehydrate');
    const modelParamsSpy = vi.spyOn(useModelParamsStore.persist, 'rehydrate');

    registerHydrationCoordination();

    expect(settingsSpy).toHaveBeenCalledTimes(1);
    expect(ragSpy).toHaveBeenCalledTimes(1);
    expect(modelSpy).toHaveBeenCalledTimes(1);
    expect(modelParamsSpy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when isHydrated is already true', () => {
    useUIStore.getState().setHydrated(true);

    const settingsSpy = vi.spyOn(useSettingsStore.persist, 'rehydrate');
    const modelSpy = vi.spyOn(useModelStore.persist, 'rehydrate');

    registerHydrationCoordination();

    expect(settingsSpy).not.toHaveBeenCalled();
    expect(modelSpy).not.toHaveBeenCalled();
    expect(useUIStore.getState()._pendingRehydrations).toBe(0);
  });

  it('counter ticks down on every onStoreRehydrated callback (4 calls → isHydrated=true)', () => {
    registerHydrationCoordination();

    for (let i = 0; i < 3; i += 1) {
      useUIStore.getState().onStoreRehydrated();
      expect(useUIStore.getState()._pendingRehydrations).toBe(3 - i);
      expect(useUIStore.getState().isHydrated).toBe(false);
    }

    useUIStore.getState().onStoreRehydrated();
    expect(useUIStore.getState()._pendingRehydrations).toBe(0);
    expect(useUIStore.getState().isHydrated).toBe(true);
  });

  it('cleanup callback is safe to invoke (subsequent disposal is a no-op)', () => {
    const cleanup = registerHydrationCoordination();
    expect(() => {
      cleanup();
      cleanup();
    }).not.toThrow();
    expect(useUIStore.getState()._pendingRehydrations).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// stopStream — abort
// ---------------------------------------------------------------------------
// `stopStream(convId, 'abort')` flushes buffered content, marks the last
// assistant message `stopped: true`, removes the stream from the streaming
// store, and clears `isStreaming` when no streams remain.
describe('stopStream — abort', () => {
  beforeEach(() => {
    useStreamingStore.setState({
      liveContent: { 'conv-1': { chunks: ['hello'] } },
      pendingMetrics: {},
      activeStreams: { 'conv-1': 'req-1' },
      flushedStreams: new Set<string>(),
    });
    useMessageStore.setState({
      messages: {
        'conv-1': [
          { id: 'msg-1', role: 'user', content: 'hi', timestamp: 1 },
          { id: 'msg-2', role: 'assistant', content: 'partial', timestamp: 2, done: false },
        ],
      },
    });
    useUIStore.setState({ isStreaming: true });
  });

  it('flushes buffered content, marks stopped, and clears the stream', () => {
    stopStream('conv-1', 'abort');

    const messages = useMessageStore.getState().messages['conv-1'];
    const lastMsg = messages[messages.length - 1];
    // flushAndStop appends buffered content to the existing message
    expect(lastMsg.content).toBe('partialhello');
    expect(lastMsg.done).toBe(true);
    expect(lastMsg.stopped).toBe(true);
    expect(useUIStore.getState().isStreaming).toBe(false);
  });

  it('is idempotent — calling twice does not double-flush', () => {
    stopStream('conv-1', 'abort');
    stopStream('conv-1', 'abort');

    const messages = useMessageStore.getState().messages['conv-1'];
    expect(messages.length).toBe(2); // no duplicate message appended
  });

  it('does not clear the global streaming flag when other streams are active', () => {
    useStreamingStore.setState({
      activeStreams: { 'conv-1': 'req-1', 'conv-2': 'req-2' },
    });

    stopStream('conv-1', 'abort');

    expect(useUIStore.getState().isStreaming).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Abort race guard
// ---------------------------------------------------------------------------
// When a caller reads `activeStreams[convId]` to abort a request and then
// calls `stopStream(convId, 'abort', expectedRequestId)`, a new stream
// may have already replaced the old one. The guard ensures the new stream is
// left untouched — its buffered content is not flushed, its state is not
// cleared, and the last message is not marked `stopped: true`.
describe('stopStream — abort race guard', () => {
  beforeEach(() => {
    useStreamingStore.setState({
      liveContent: { 'conv-1': { chunks: ['new-stream-content'] } },
      pendingMetrics: {},
      activeStreams: { 'conv-1': 'req-2' },
      flushedStreams: new Set<string>(),
    });
    useMessageStore.setState({
      messages: {
        'conv-1': [
          { id: 'msg-1', role: 'user', content: 'hi', timestamp: 1 },
          { id: 'msg-2', role: 'assistant', content: 'partial', timestamp: 2, done: false },
        ],
      },
    });
    useUIStore.setState({ isStreaming: true });
  });

  it('bails out when expectedRequestId does not match the active stream', () => {
    // The caller read req-1 (the old stream), but the active stream is now req-2.
    stopStream('conv-1', 'abort', 'req-1');

    const messages = useMessageStore.getState().messages['conv-1'];
    const lastMsg = messages[messages.length - 1];
    // The new stream's buffered content must NOT be flushed onto the message
    expect(lastMsg.content).toBe('partial');
    expect(lastMsg.done).toBe(false);
    // `stopped` must not be set to true by the guard bail-out. (It may be
    // undefined, which is falsy — the key is that it's not `true`.)
    expect(lastMsg.stopped).not.toBe(true);
    // The active stream must remain untouched
    expect(useStreamingStore.getState().activeStreams['conv-1']).toBe('req-2');
    expect(useStreamingStore.getState().liveContent['conv-1']).toBeDefined();
    // The global streaming flag must NOT be cleared (new stream is active)
    expect(useUIStore.getState().isStreaming).toBe(true);
  });

  it('proceeds normally when expectedRequestId matches the active stream', () => {
    stopStream('conv-1', 'abort', 'req-2');

    const messages = useMessageStore.getState().messages['conv-1'];
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.content).toBe('partialnew-stream-content');
    expect(lastMsg.done).toBe(true);
    expect(lastMsg.stopped).toBe(true);
    expect(useStreamingStore.getState().activeStreams['conv-1']).toBeUndefined();
    expect(useUIStore.getState().isStreaming).toBe(false);
  });

  it('proceeds normally when expectedRequestId is omitted (backward compat)', () => {
    stopStream('conv-1', 'abort');

    const messages = useMessageStore.getState().messages['conv-1'];
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.content).toBe('partialnew-stream-content');
    expect(lastMsg.done).toBe(true);
    expect(lastMsg.stopped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stopStream — complete
// ---------------------------------------------------------------------------
// `stopStream(convId, 'complete')` flushes buffered content + metrics,
// clears the `stopped` flag on the last assistant message, removes the
// stream, and clears `isStreaming` when no streams remain.
describe('stopStream — complete', () => {
  beforeEach(() => {
    useStreamingStore.setState({
      liveContent: { 'conv-1': { chunks: ['hello'] } },
      pendingMetrics: { 'conv-1': { promptEvalCount: 42, evalCount: 10 } },
      activeStreams: { 'conv-1': 'req-1' },
      flushedStreams: new Set<string>(),
    });
    useMessageStore.setState({
      messages: {
        'conv-1': [
          { id: 'msg-1', role: 'user', content: 'hi', timestamp: 1 },
          { id: 'msg-2', role: 'assistant', content: 'partial', timestamp: 2, done: false },
        ],
      },
    });
    useUIStore.setState({ isStreaming: true });
  });

  it('flushes buffered content + metrics and marks done, and clears stopped', () => {
    stopStream('conv-1', 'complete');

    const messages = useMessageStore.getState().messages['conv-1'];
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.content).toBe('partialhello');
    expect(lastMsg.done).toBe(true);
    // Natural completion must NOT show "Stopped by user" — explicitly false
    expect(lastMsg.stopped).toBe(false);
    expect(lastMsg.promptEvalCount).toBe(42);
    expect(lastMsg.evalCount).toBe(10);
    expect(useUIStore.getState().isStreaming).toBe(false);
  });

  it('clears a previously-set stopped:true flag on natural completion', () => {
    // Reproduces: a conversation whose previous message was
    // user-stopped should not carry `stopped: true` forward onto the next
    // naturally-completed message.
    useMessageStore.setState({
      messages: {
        'conv-1': [
          { id: 'msg-1', role: 'user', content: 'hi', timestamp: 1 },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'partial',
            timestamp: 2,
            done: false,
            stopped: true,
          },
        ],
      },
    });

    stopStream('conv-1', 'complete');

    const messages = useMessageStore.getState().messages['conv-1'];
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.done).toBe(true);
    expect(lastMsg.stopped).toBe(false);
  });

  it('does not set stopped:true even when there is no buffered content', () => {
    useStreamingStore.setState({
      liveContent: {},
      pendingMetrics: {},
    });

    stopStream('conv-1', 'complete');

    const messages = useMessageStore.getState().messages['conv-1'];
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.stopped).toBe(false);
  });

  it('is idempotent — calling twice does not double-flush', () => {
    stopStream('conv-1', 'complete');
    stopStream('conv-1', 'complete');

    const messages = useMessageStore.getState().messages['conv-1'];
    expect(messages.length).toBe(2);
  });

  it('does not clear the global streaming flag when other streams are active', () => {
    useStreamingStore.setState({
      activeStreams: { 'conv-1': 'req-1', 'conv-2': 'req-2' },
    });

    stopStream('conv-1', 'complete');

    expect(useUIStore.getState().isStreaming).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stopStream — error
// ---------------------------------------------------------------------------
// `stopStream(convId, 'error')` flushes buffered content (so partial tokens
// are not lost), does NOT set `stopped: true` (that flag is reserved for
// user-initiated aborts — a backend error is not a user stop), removes the
// stream, and clears `isStreaming` when no streams remain. The error
// prefix / `error` marker on the message is the caller's responsibility
// (see useChatStream.handleStreamError), which is why `stopStream` only
// touches `done` via the flush and leaves `stopped` untouched.
describe('stopStream — error', () => {
  beforeEach(() => {
    useStreamingStore.setState({
      liveContent: { 'conv-1': { chunks: ['hello'] } },
      pendingMetrics: { 'conv-1': { promptEvalCount: 42, evalCount: 10 } },
      activeStreams: { 'conv-1': 'req-1' },
      flushedStreams: new Set<string>(),
    });
    useMessageStore.setState({
      messages: {
        'conv-1': [
          { id: 'msg-1', role: 'user', content: 'hi', timestamp: 1 },
          { id: 'msg-2', role: 'assistant', content: 'partial', timestamp: 2, done: false },
        ],
      },
    });
    useUIStore.setState({ isStreaming: true });
  });

  it('flushes buffered content + metrics and marks done', () => {
    stopStream('conv-1', 'error');

    const messages = useMessageStore.getState().messages['conv-1'];
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.content).toBe('partialhello');
    expect(lastMsg.done).toBe(true);
    expect(lastMsg.promptEvalCount).toBe(42);
    expect(lastMsg.evalCount).toBe(10);
  });

  it('does NOT set stopped:true — that flag is reserved for user aborts', () => {
    stopStream('conv-1', 'error');

    const messages = useMessageStore.getState().messages['conv-1'];
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.stopped).not.toBe(true);
  });

  it('does not clear a previously-set stopped:true flag (unlike complete)', () => {
    // A previously user-stopped message that then hits a backend error
    // should NOT have its `stopped` flag cleared — `stopStream('error')`
    // leaves `stopped` untouched. (Only 'complete' explicitly clears it.)
    useMessageStore.setState({
      messages: {
        'conv-1': [
          { id: 'msg-1', role: 'user', content: 'hi', timestamp: 1 },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'partial',
            timestamp: 2,
            done: false,
            stopped: true,
          },
        ],
      },
    });

    stopStream('conv-1', 'error');

    const messages = useMessageStore.getState().messages['conv-1'];
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.stopped).toBe(true);
  });

  it('clears the stream and isStreaming when no streams remain', () => {
    stopStream('conv-1', 'error');

    expect(useStreamingStore.getState().activeStreams['conv-1']).toBeUndefined();
    expect(useUIStore.getState().isStreaming).toBe(false);
  });

  it('does not clear isStreaming when other streams are active', () => {
    useStreamingStore.setState({
      activeStreams: { 'conv-1': 'req-1', 'conv-2': 'req-2' },
    });

    stopStream('conv-1', 'error');

    expect(useUIStore.getState().isStreaming).toBe(true);
  });

  it('is idempotent — calling twice does not double-flush', () => {
    stopStream('conv-1', 'error');
    stopStream('conv-1', 'error');

    const messages = useMessageStore.getState().messages['conv-1'];
    expect(messages.length).toBe(2);
  });

  it('respects the abort race guard — bails out when expectedRequestId mismatches', () => {
    useStreamingStore.setState({
      activeStreams: { 'conv-1': 'req-2' },
      liveContent: { 'conv-1': { chunks: ['new-stream-content'] } },
    });

    // Caller read req-1 (the old stream), but the active stream is now req-2.
    stopStream('conv-1', 'error', 'req-1');

    const messages = useMessageStore.getState().messages['conv-1'];
    const lastMsg = messages[messages.length - 1];
    // The new stream's buffered content must NOT be flushed onto the message
    expect(lastMsg.content).toBe('partial');
    expect(lastMsg.done).toBe(false);
    // `stopped` must not be set to true by the guard bail-out
    expect(lastMsg.stopped).not.toBe(true);
    // The active stream must remain untouched
    expect(useStreamingStore.getState().activeStreams['conv-1']).toBe('req-2');
    expect(useUIStore.getState().isStreaming).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stopStream — batch-end (no flush, no message marker)
// ---------------------------------------------------------------------------
// `stopStream(convId, 'batch-end')` skips flushing entirely — buffered
// content is discarded. It removes the stream from the store and clears
// `isStreaming` when no streams remain. No `stopped` marker is set.
describe('stopStream — batch-end', () => {
  beforeEach(() => {
    useStreamingStore.setState({
      liveContent: { 'conv-1': { chunks: ['discard-me'] } },
      pendingMetrics: {},
      activeStreams: { 'conv-1': 'req-1' },
      flushedStreams: new Set<string>(),
    });
    useMessageStore.setState({
      messages: {
        'conv-1': [
          { id: 'msg-1', role: 'user', content: 'hi', timestamp: 1 },
          { id: 'msg-2', role: 'assistant', content: 'partial', timestamp: 2, done: false },
        ],
      },
    });
    useUIStore.setState({ isStreaming: true });
  });

  it('does not flush buffered content onto the message', () => {
    stopStream('conv-1', 'batch-end');

    const messages = useMessageStore.getState().messages['conv-1'];
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.content).toBe('partial');
  });

  it('does not set stopped on the message', () => {
    stopStream('conv-1', 'batch-end');

    const messages = useMessageStore.getState().messages['conv-1'];
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.stopped).not.toBe(true);
  });

  it('clears the stream and isStreaming', () => {
    stopStream('conv-1', 'batch-end');

    expect(useStreamingStore.getState().activeStreams['conv-1']).toBeUndefined();
    expect(useUIStore.getState().isStreaming).toBe(false);
  });
});
