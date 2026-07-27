import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUIStore } from '@/store/ui-store';
import { useSettingsStore } from '@/store/settings-store';
import { useRagStore } from '@/store/rag-store';
import { useModelStore } from '@/store/model-store';
import { useConversationStore } from '@/store/conversation-store';
import { useStreamingStore } from '@/store/streaming-store';
import { useMessageStore } from '@/store/message-store';
import { registerHydrationCoordination, coordinateStopStream } from './coordination';

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
  it('initializes the pending rehydrations counter to 5 (one per persisted store)', () => {
    registerHydrationCoordination();
    expect(useUIStore.getState()._pendingRehydrations).toBe(5);
  });

  it('triggers rehydrate on every persisted store (settings, rag, model, conversation, streaming)', () => {
    const settingsSpy = vi.spyOn(useSettingsStore.persist, 'rehydrate');
    const ragSpy = vi.spyOn(useRagStore.persist, 'rehydrate');
    const modelSpy = vi.spyOn(useModelStore.persist, 'rehydrate');
    const conversationSpy = vi.spyOn(useConversationStore.persist, 'rehydrate');
    const streamingSpy = vi.spyOn(
      (useStreamingStore as unknown as { persist: { rehydrate: () => unknown } }).persist,
      'rehydrate'
    );

    registerHydrationCoordination();

    expect(settingsSpy).toHaveBeenCalledTimes(1);
    expect(ragSpy).toHaveBeenCalledTimes(1);
    expect(modelSpy).toHaveBeenCalledTimes(1);
    expect(conversationSpy).toHaveBeenCalledTimes(1);
    expect(streamingSpy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when isHydrated is already true', () => {
    useUIStore.getState().setHydrated(true);

    const settingsSpy = vi.spyOn(useSettingsStore.persist, 'rehydrate');
    const conversationSpy = vi.spyOn(useConversationStore.persist, 'rehydrate');
    const streamingSpy = vi.spyOn(
      (useStreamingStore as unknown as { persist: { rehydrate: () => unknown } }).persist,
      'rehydrate'
    );

    registerHydrationCoordination();

    expect(settingsSpy).not.toHaveBeenCalled();
    expect(conversationSpy).not.toHaveBeenCalled();
    expect(streamingSpy).not.toHaveBeenCalled();
    expect(useUIStore.getState()._pendingRehydrations).toBe(0);
  });

  it('counter ticks down on every onStoreRehydrated callback (5 calls → isHydrated=true)', () => {
    registerHydrationCoordination();

    for (let i = 0; i < 4; i += 1) {
      useUIStore.getState().onStoreRehydrated();
      expect(useUIStore.getState()._pendingRehydrations).toBe(4 - i);
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
    expect(useUIStore.getState()._pendingRehydrations).toBe(5);
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
