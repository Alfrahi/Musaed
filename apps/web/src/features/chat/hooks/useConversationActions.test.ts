import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useConversationActions } from './useConversationActions';
import { useBatchUpdate, useSetConversations } from '@/store/hooks';
import { coordinateStopStream } from '@/store/coordination';
import { chatApi } from '@/lib/ipc';
import { useStreamingStore } from '@/store/stores/streaming-store';
import { useMessageStore } from '@/store/stores/message-store';
import { useConversationStore } from '@/store/stores/conversation-store';

// Mock hooks
vi.mock('@/store/hooks', () => ({
  useSetConversations: vi.fn(() => vi.fn()),
  useBatchUpdate: vi.fn(() => vi.fn()),
  useLanguage: vi.fn(() => 'en'),
}));

vi.mock('@/store/batch-manager', () => ({
  stopBatching: vi.fn(),
}));

vi.mock('@/store/coordination', () => ({
  coordinateStartStream: vi.fn(),
  coordinateStopStream: vi.fn(),
}));

vi.mock('@/store/stores/ui-store', () => {
  const getState = vi.fn(() => ({
    isStreaming: false,
    isHydrated: true,
    setStreaming: vi.fn(),
    setHydrated: vi.fn(),
  }));
  const useUIStore: any = vi.fn(() => getState());
  useUIStore.getState = getState;
  return { useUIStore };
});

vi.mock('@/lib/ipc', () => ({
  checkIsTauri: vi.fn(() => true),
  chatApi: { abort: vi.fn() },
  conversationApi: {
    listConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn().mockResolvedValue('conv1'),
    appendMessage: vi.fn(),
    deleteConversation: vi.fn(),
    clearAllConversations: vi.fn(),
  },
  logApi: {
    append: vi.fn(),
    clear: vi.fn(),
  },
  store: {
    load: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue([]),
      set: vi.fn(),
      save: vi.fn(),
    }),
  },
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Store mocks with getState/setState as needed
vi.mock('@/store/stores/settings-store', () => {
  const getState = vi.fn(() => ({
    globalSettings: { language: 'en' },
    setGlobalSettings: vi.fn(),
  }));
  const useSettingsStore: any = vi.fn(() => getState());
  useSettingsStore.getState = getState;
  return { useSettingsStore };
});

vi.mock('@/store/stores/conversation-store', () => {
  const getState = vi.fn(() => ({
    conversations: {},
    conversationIds: [],
    currentConversationId: null,
    addConversation: vi.fn(),
    updateConversation: vi.fn(),
    removeConversation: vi.fn(),
    batchUpdate: vi.fn(),
  }));
  const useConversationStore: any = vi.fn(() => getState());
  useConversationStore.getState = getState;
  return { useConversationStore };
});

vi.mock('@/store/stores/message-store', () => {
  const getState = vi.fn(() => ({
    messages: {},
    clearMessages: vi.fn(),
  }));
  const setState = vi.fn();
  const useMessageStore: any = vi.fn(() => getState());
  useMessageStore.getState = getState;
  useMessageStore.setState = setState;
  return { useMessageStore };
});

vi.mock('@/store/stores/model-store', () => {
  const getState = vi.fn(() => ({
    selectedModel: 'llama3',
  }));
  const useModelStore: any = vi.fn(() => getState());
  useModelStore.getState = getState;
  return { useModelStore };
});

vi.mock('@/store/stores/streaming-store', () => {
  const getState = vi.fn(() => ({
    activeStreams: {},
    startStream: vi.fn(),
    stopStream: vi.fn(),
    clearStream: vi.fn(),
  }));
  const useStreamingStore: any = vi.fn(() => getState());
  useStreamingStore.getState = getState;
  return { useStreamingStore };
});

// Get references to the mock functions for configuration
const mockUseBatchUpdate = useBatchUpdate as any;
const mockUseSetConversations = useSetConversations as any;
const mockCoordinateStopStream = coordinateStopStream as any;
const mockUseStreamingStore = useStreamingStore as any;
const mockUseMessageStore = useMessageStore as any;
const mockUseConversationStore = useConversationStore as any;

describe('useConversationActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default implementations
    mockUseBatchUpdate.mockReturnValue(vi.fn());
    mockUseSetConversations.mockReturnValue(vi.fn());

    // Streaming store default
    mockUseStreamingStore.getState.mockReturnValue({
      activeStreams: {},
      startStream: vi.fn(),
      stopStream: vi.fn(),
      clearStream: vi.fn(),
    });

    // Message store default
    mockUseMessageStore.getState.mockReturnValue({
      messages: {},
      clearMessages: vi.fn(),
    });
    mockUseMessageStore.setState = vi.fn();
  });

  it('creates a new conversation with current model and settings', async () => {
    const mockBatchUpdate = vi.fn((fn) =>
      fn({
        conversations: {},
        conversationIds: [],
        currentConversationId: null,
      })
    );
    mockUseBatchUpdate.mockReturnValue(mockBatchUpdate);

    const { result } = renderHook(() => useConversationActions());

    await act(async () => {
      result.current.createNewConversation();
      // Flush microtasks for the async createConversation call
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockBatchUpdate).toHaveBeenCalled();
  });

  it('deletes conversation and clears messages', () => {
    const mockBatchUpdate = vi.fn();
    const mockClearMessages = vi.fn();

    mockUseBatchUpdate.mockReturnValue(mockBatchUpdate);
    mockUseMessageStore.getState.mockReturnValue({
      messages: {},
      clearMessages: mockClearMessages,
    });
    mockUseConversationStore.getState.mockReturnValue({
      conversations: {
        conv1: {
          id: 'conv1',
          title: 'Test',
          model: 'llama3',
          settings: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
      conversationIds: ['conv1'],
      currentConversationId: 'conv1',
    });

    const { result } = renderHook(() => useConversationActions());

    act(() => {
      result.current.deleteConversation('conv1');
    });

    expect(mockBatchUpdate).toHaveBeenCalled();
    expect(mockClearMessages).toHaveBeenCalledWith('conv1');
  });

  it('aborts streaming when deleting conversation', () => {
    mockUseStreamingStore.getState.mockReturnValue({
      activeStreams: { conv1: 'req123' },
      startStream: vi.fn(),
      stopStream: vi.fn(),
      clearStream: vi.fn(),
    });

    const { result } = renderHook(() => useConversationActions());

    act(() => {
      result.current.deleteConversation('conv1');
    });

    expect(mockCoordinateStopStream).toHaveBeenCalledWith('conv1');
  });

  it('updates conversation title and timestamp', () => {
    const mockSetConversations = vi.fn();
    mockUseSetConversations.mockReturnValue(mockSetConversations);

    const { result } = renderHook(() => useConversationActions());

    act(() => {
      result.current.updateConversationTitle('conv1', 'New Title');
    });

    expect(mockSetConversations).toHaveBeenCalled();
  });

  it('clears all conversations, ids, and messages', () => {
    const mockBatchUpdate = vi.fn();
    mockUseBatchUpdate.mockReturnValue(mockBatchUpdate);

    const { result } = renderHook(() => useConversationActions());

    act(() => {
      result.current.clearAllConversations();
    });

    expect(mockBatchUpdate).toHaveBeenCalled();
    expect(mockUseMessageStore.setState).toHaveBeenCalledWith({ messages: {} });
  });

  it('aborts all active streams before clearing', () => {
    mockUseStreamingStore.getState.mockReturnValue({
      activeStreams: { conv1: 'req1', conv2: 'req2' },
      startStream: vi.fn(),
      stopStream: vi.fn(),
      clearStream: vi.fn(),
    });

    const { result } = renderHook(() => useConversationActions());

    act(() => {
      result.current.clearAllConversations();
    });

    expect(mockCoordinateStopStream).toHaveBeenCalled();
    expect(chatApi.abort).toHaveBeenCalled();
  });
});
