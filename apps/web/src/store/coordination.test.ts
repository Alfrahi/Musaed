// Updated coordination tests after removing persistence from conversation and streaming stores
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUIStore } from '@/store/ui-store';
import { useSettingsStore } from '@/store/settings-store';
import { useRagStore } from '@/store/rag-store';
import { useModelStore } from '@/store/model-store';
import { useStreamingStore } from '@/store/streaming-store';
import { useMessageStore } from '@/store/message-store';
import {
  registerHydrationCoordination,
  coordinateStopStream,
  stopStreamForConversation,
} from './coordination';

beforeEach(() => {
  (window as any).__TAURI_INTERNALS__ = {};
  useUIStore.setState({
    isStreaming: false,
    isInitialized: false,
    isHydrated: false,
    isOllamaConnected: false,
    errorMessage: null,
    isSettingsOpen: false,
    isLibraryOpen: false,
    isInfoOpen: false,
    _pendingRehydrations: 0,
  });
});

describe('registerHydrationCoordination', () => {
  it('initializes the pending rehydrations counter to 3 (one per persisted store)', () => {
    registerHydrationCoordination();
    expect(useUIStore.getState()._pendingRehydrations).toBe(3);
  });

  it('triggers rehydrate on every persisted store (settings, rag, model)', () => {
    const settingsSpy = vi.spyOn(useSettingsStore.persist, 'rehydrate');
    const ragSpy = vi.spyOn(useRagStore.persist, 'rehydrate');
    const modelSpy = vi.spyOn(useModelStore.persist, 'rehydrate');

    registerHydrationCoordination();

    expect(settingsSpy).toHaveBeenCalledTimes(1);
    expect(ragSpy).toHaveBeenCalledTimes(1);
    expect(modelSpy).toHaveBeenCalledTimes(1);
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

  it('counter ticks down on every onStoreRehydrated callback (3 calls → isHydrated=true)', () => {
    registerHydrationCoordination();

    for (let i = 0; i < 2; i += 1) {
      useUIStore.getState().onStoreRehydrated();
      expect(useUIStore.getState()._pendingRehydrations).toBe(2 - i);
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
    expect(useUIStore.getState()._pendingRehydrations).toBe(3);
  });
});

describe('coordinateStopStream', () => {
  beforeEach(() => {
    useStreamingStore.setState({
      liveContent: {},
      pendingMetrics: {},
      activeStreams: { 'conv-1': 'req-1' },
      flushedStreams: [],
    });
    useMessageStore.setState({
      messages: {
        'conv-1': [
          { id: 'msg-1', role: 'user', content: 'hello', timestamp: 1 },
          { id: 'msg-2', role: 'assistant', content: 'hi', timestamp: 2, done: true },
        ],
      },
    });
    useUIStore.setState({ isStreaming: true });
  });

  it('sets stopped: true on the last assistant message', () => {
    coordinateStopStream('conv-1');

    const messages = useMessageStore.getState().messages['conv-1'];
    expect(messages[messages.length - 1].stopped).toBe(true);
  });

  it('clears the global streaming flag when no streams remain', () => {
    coordinateStopStream('conv-1');

    expect(useUIStore.getState().isStreaming).toBe(false);
  });

  it('does not clear the global streaming flag when other streams are active', () => {
    useStreamingStore.setState({
      activeStreams: { 'conv-1': 'req-1', 'conv-2': 'req-2' },
    });

    coordinateStopStream('conv-1');

    expect(useUIStore.getState().isStreaming).toBe(true);
  });
});

describe('stopStreamForConversation', () => {
  beforeEach(() => {
    useStreamingStore.setState({
      liveContent: { 'conv-1': { chunks: ['hello'] } },
      pendingMetrics: {},
      activeStreams: { 'conv-1': 'req-1' },
      flushedStreams: [],
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
    stopStreamForConversation('conv-1');

    const messages = useMessageStore.getState().messages['conv-1'];
    const lastMsg = messages[messages.length - 1];
    // flushAndStop appends buffered content to the existing message
    expect(lastMsg.content).toBe('partialhello');
    expect(lastMsg.done).toBe(true);
    expect(lastMsg.stopped).toBe(true);
    expect(useUIStore.getState().isStreaming).toBe(false);
  });

  it('is idempotent — calling twice does not double-flush', () => {
    stopStreamForConversation('conv-1');
    stopStreamForConversation('conv-1');

    const messages = useMessageStore.getState().messages['conv-1'];
    expect(messages.length).toBe(2); // no duplicate message appended
  });

  it('does not clear the global streaming flag when other streams are active', () => {
    useStreamingStore.setState({
      activeStreams: { 'conv-1': 'req-1', 'conv-2': 'req-2' },
    });

    stopStreamForConversation('conv-1');

    expect(useUIStore.getState().isStreaming).toBe(true);
  });
});
