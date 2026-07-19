import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUIStore } from '@/store/ui-store';
import { useSettingsStore } from '@/features/settings/store/settings-store';
import { useRagStore } from '@/features/rag/store/rag-store';
import { useModelStore } from '@/features/settings/store/model-store';
import { useConversationStore } from '@/features/conversation/store/conversation-store';
import { useStreamingStore } from '@/features/conversation/store/streaming-store';
import { registerHydrationCoordination } from './coordination';

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
