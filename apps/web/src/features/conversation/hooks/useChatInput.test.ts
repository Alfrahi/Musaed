// Regression test for the reactivity bug where useChatInput read
// `isStreaming`, `selectedModel`, `currentConversationId`, and `enterToSend`
// via non-reactive `getState()` snapshots, so InputArea's Stop/Send button
// and shortcut label stayed stale across streaming-state transitions.
//
// This test exercises the REAL useChatInput hook (not an auto-mock) so the
// reactive store subscriptions are genuinely verified.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from './shared/setup';
import { mockAllDependencies } from './shared/mocks';
import { mockStores } from './shared/mocks';

// useAttachmentManager and useChatSend are sibling hooks. Mock them so the
// hook under test is isolated to its OWN reactive-store wiring.
vi.mock('./useAttachmentManager', () => ({
  useAttachmentManager: () => ({
    images: [],
    files: [],
    handleTauriImageUpload: vi.fn(),
    handleTauriFileUpload: vi.fn(),
    handleDroppedFiles: vi.fn(),
    removeImage: vi.fn(),
    removeFile: vi.fn(),
    clearAttachments: vi.fn(),
  }),
}));

vi.mock('./useChatSend', () => ({
  useChatSend: () => ({ sendMessage: vi.fn(), editAndResend: vi.fn() }),
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    formatNumber: (n: number) => String(n),
    formatDate: (d: number | Date) => String(d),
    isRtl: false,
    formatFileSize: (b: number) => `${b} B`,
  }),
}));

import { useChatInput } from './useChatInput';

beforeEach(() => {
  mockAllDependencies();
  vi.clearAllMocks();
  // Reset the shared streaming-store mock state to a clean baseline
  // (no active streams) before every test. The hook under test subscribes
  // to this slice; mutating it must trigger re-render.
  mockStores.streamingStore.activeStreams = {};
  // Reset settings + model + conversation defaults.
  mockStores.modelStore.selectedModel = 'llama3';
  mockStores.conversationStore.currentConversationId = 'conv1';
  mockStores.settingsStore.globalSettings.enterToSend = true;
});

describe('useChatInput (reactivity)', () => {
  it('reflects isStreaming changes when the streaming store starts/stops', () => {
    const { result, rerender } = renderHook(() => useChatInput());

    expect(result.current.isStreaming).toBe(false);

    // Start streaming on the current conversation.
    act(() => {
      mockStores.streamingStore.activeStreams['conv1'] = 'req-1';
    });
    rerender();
    expect(result.current.isStreaming).toBe(true);

    // Stop streaming.
    act(() => {
      delete mockStores.streamingStore.activeStreams['conv1'];
    });
    rerender();
    expect(result.current.isStreaming).toBe(false);
  });

  it('reflects selectedModel changes from the model store', () => {
    const { result, rerender } = renderHook(() => useChatInput());

    expect(result.current.selectedModel).toBe('llama3');

    act(() => {
      mockStores.modelStore.selectedModel = 'mistral';
    });
    rerender();
    expect(result.current.selectedModel).toBe('mistral');
  });

  it('reflects currentConversationId changes from the conversation store', () => {
    const { result, rerender } = renderHook(() => useChatInput());

    expect(result.current.currentConversationId).toBe('conv1');

    act(() => {
      mockStores.conversationStore.currentConversationId = 'conv-other';
    });
    rerender();
    expect(result.current.currentConversationId).toBe('conv-other');
  });

  it('reflects enterToSend changes from the settings store', () => {
    const { result, rerender } = renderHook(() => useChatInput());

    expect(result.current.enterToSend).toBe(true);

    act(() => {
      mockStores.settingsStore.globalSettings.enterToSend = false;
    });
    rerender();
    expect(result.current.enterToSend).toBe(false);
  });

  it('reports isStreaming=false when currentConversationId is null', () => {
    mockStores.conversationStore.currentConversationId = null as unknown as string;
    const { result } = renderHook(() => useChatInput());

    expect(result.current.currentConversationId).toBeNull();
    expect(result.current.isStreaming).toBe(false);
  });

  it('reports isStreaming per-conversation (only the active conv shows streaming)', () => {
    mockStores.conversationStore.currentConversationId = 'convA';
    const { result, rerender } = renderHook(() => useChatInput());

    // A different conversation is streaming — must NOT flip our isStreaming.
    act(() => {
      mockStores.streamingStore.activeStreams['convB'] = 'req-other';
    });
    rerender();
    expect(result.current.isStreaming).toBe(false);

    // Our conversation starts streaming — must flip.
    act(() => {
      mockStores.streamingStore.activeStreams['convA'] = 'req-a';
    });
    rerender();
    expect(result.current.isStreaming).toBe(true);
  });
});
