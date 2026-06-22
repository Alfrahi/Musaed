import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
// Mock dependencies - all mocks defined inline in the factory to avoid hoisting issues
vi.mock('@/lib/ipc', () => ({
  checkIsTauri: vi.fn(() => true),
  chatApi: {
    chat: vi.fn().mockResolvedValue(true),
    abort: vi.fn(),
  },
  conversationApi: {
    listConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn().mockResolvedValue('conv1'),
    appendMessage: vi.fn(),
    deleteConversation: vi.fn(),
    clearAllConversations: vi.fn(),
    updateConversation: vi.fn(),
  },
  ragApi: {
    search: vi.fn(),
  },
  store: {
    load: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue([]),
      set: vi.fn(),
      save: vi.fn(),
    }),
  },
  logApi: {
    append: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock('@/store/batch-manager', () => ({
  flushAndStop: vi.fn(),
}));

vi.mock('@/store/coordination', () => ({
  coordinateStartStream: vi.fn(),
  coordinateStopStream: vi.fn(),
  flushAndStop: vi.fn(),
}));

vi.mock('@/store/ui-store', () => {
  const uiState = {
    isStreaming: false,
    isHydrated: true,
    setStreaming: vi.fn(),
    setHydrated: vi.fn(),
    errorMessage: null,
    setErrorMessage: vi.fn(),
  };
  const useUIStore: any = vi.fn(() => uiState);
  useUIStore.getState = vi.fn(() => uiState);
  return { useUIStore };
});

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Store mocks: provide getState on the hook itself
vi.mock('@/features/conversation/store/message-store', () => {
  const getState = vi.fn(() => ({
    messages: {},
    addMessages: vi.fn(),
    updateLastMessage: vi.fn(),
  }));
  const useMessageStore: any = vi.fn(() => getState());
  useMessageStore.getState = getState;
  return { useMessageStore };
});

vi.mock('@/features/conversation/store/streaming-store', () => {
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

vi.mock('@/features/settings/store/model-store', () => {
  const getState = vi.fn(() => ({
    selectedModel: 'llama3',
  }));
  const useModelStore: any = vi.fn(() => getState());
  useModelStore.getState = getState;
  return { useModelStore };
});

// Conversation store hooks mock
vi.mock('@/features/conversation/store/conversation-store', () => {
  const getState = vi.fn(() => ({
    conversations: {
      conv1: {
        id: 'conv1',
        title: 'Test',
        model: 'llama3',
        settings: {
          ollamaUrl: 'http://localhost:11434',
          systemPrompt: '',
          temperature: 0.7,
          top_k: 40,
          top_p: 0.9,
          stop: [],
          num_predict: 2048,
          num_ctx: 4096,
          language: 'en',
          theme: 'system',
          hasDetectedLanguage: false,
          enterToSend: true,
          chatRetentionDays: 0,
          enableLatex: false,
          enableMermaid: true,
          density: 1.0,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
    conversationIds: ['conv1'],
    currentConversationId: 'conv1',
  }));
  const useConversationStore: any = vi.fn(() => getState());
  useConversationStore.getState = getState;
  return {
    useCurrentConversationId: vi.fn(() => 'conv1'),
    useConversations: vi.fn(() => ({
      conv1: {
        id: 'conv1',
        title: 'Test',
        model: 'llama3',
        settings: {
          ollamaUrl: 'http://localhost:11434',
          systemPrompt: '',
          temperature: 0.7,
          top_k: 40,
          top_p: 0.9,
          stop: [],
          num_predict: 2048,
          num_ctx: 4096,
          language: 'en',
          theme: 'system',
          hasDetectedLanguage: false,
          enterToSend: true,
          chatRetentionDays: 0,
          enableLatex: false,
          enableMermaid: true,
          density: 1.0,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    })),
    useSetConversations: vi.fn(() => vi.fn()),
    useUpdateConversation: vi.fn(() => vi.fn()),
    useBatchUpdate: vi.fn(() => vi.fn()),
    useConversationStore,
  };
});

// Settings store hooks mock - model-store
vi.mock('@/features/settings/store/model-store', () => ({
  useModelStore: vi.fn(() => ({
    selectedModel: 'llama3',
    models: [],
  })),
  useSelectedModel: vi.fn(() => 'llama3'),
}));

// Settings store hooks mock - settings-store
vi.mock('@/features/settings/store/settings-store', () => {
  const getState = vi.fn(() => ({
    globalSettings: {
      ollamaUrl: 'http://localhost:11434',
      systemPrompt: '',
      temperature: 0.7,
      top_k: 40,
      top_p: 0.9,
      stop: [],
      num_predict: 100,
      num_ctx: 2048,
      language: 'en',
      theme: 'system',
      hasDetectedLanguage: false,
      enterToSend: true,
      chatRetentionDays: 0,
      enableLatex: false,
      enableMermaid: true,
      density: 1.0,
    },
  }));
  const useSettingsStore: any = vi.fn(() => getState());
  useSettingsStore.getState = getState;
  return { useSettingsStore, useGlobalSettings: vi.fn(() => getState().globalSettings) };
});

// UI store hooks mock
vi.mock('@/store/ui-store', () => {
  const uiState = {
    isStreaming: false,
    isHydrated: true,
    setStreaming: vi.fn(),
    setHydrated: vi.fn(),
    errorMessage: null,
    setErrorMessage: vi.fn(),
  };
  const useUIStore: any = vi.fn(() => uiState);
  useUIStore.getState = vi.fn(() => uiState);
  return { useUIStore };
});

// RAG store hooks mock
vi.mock('@/features/rag/store/rag-store', () => {
  const getState = vi.fn(() => ({
    activeProjectId: null,
    projects: {},
  }));
  const useRagStore: any = vi.fn(() => getState());
  useRagStore.getState = getState;
  return { useRagStore, useActiveRagProject: vi.fn(() => null) };
});

// Chat actions hook mock (recursive - mock itself)
vi.mock('./useConversationActions', () => ({
  useConversationActions: vi.fn(() => ({
    initiateStreaming: vi.fn().mockImplementation((conversationId, requestId, onStreamUpdate) => {
      if (onStreamUpdate) onStreamUpdate('streaming-content');
      return Promise.resolve();
    }),
    stopStreaming: vi.fn(),
  })),
}));

// Import the hook under test after vi.mock (hoisted)
import { useChatActions } from './useChatActions';
import { chatApi } from '@/lib/ipc';
import {
  useCurrentConversationId,
  useConversations,
} from '@/features/conversation/store/conversation-store';
import { useSelectedModel } from '@/features/settings/store/model-store';

vi.mock('@/features/conversation/store/conversation-store', () => {
  const getState = vi.fn(() => ({
    conversations: {
      conv1: {
        id: 'conv1',
        title: 'Test',
        model: 'llama3',
        settings: {
          ollamaUrl: 'http://localhost:11434',
          systemPrompt: '',
          temperature: 0.7,
          top_k: 40,
          top_p: 0.9,
          stop: [],
          num_predict: 2048,
          num_ctx: 4096,
          language: 'en',
          theme: 'system',
          hasDetectedLanguage: false,
          enterToSend: true,
          chatRetentionDays: 0,
          enableLatex: false,
          enableMermaid: true,
          density: 1.0,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
    conversationIds: ['conv1'],
    currentConversationId: 'conv1',
  }));
  const useConversationStore: any = vi.fn(() => getState());
  useConversationStore.getState = getState;
  return {
    useCurrentConversationId: vi.fn(),
    useConversations: vi.fn(),
    useUpdateConversation: vi.fn(),
    useBatchUpdate: vi.fn(),
    useConversationStore,
  };
});

vi.mock('@/features/settings/store/model-store', () => {
  const getState = vi.fn(() => ({
    selectedModel: 'llama3',
    models: [],
  }));
  const useModelStore: any = vi.fn(() => getState());
  useModelStore.getState = getState;
  return {
    useModelStore,
    useSelectedModel: vi.fn(() => 'llama3'),
  };
});

describe('useChatActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (chatApi as any).chat = vi.fn().mockResolvedValue(true);
    vi.mocked(useCurrentConversationId).mockReturnValue('conv1');
    vi.mocked(useSelectedModel).mockReturnValue('llama3');
    vi.mocked(useConversations).mockReturnValue({
      conv1: {
        id: 'conv1',
        title: 'Test',
        model: 'llama3',
        settings: {
          ollamaUrl: 'http://localhost:11434',
          systemPrompt: '',
          temperature: 0.7,
          top_k: 40,
          top_p: 0.9,
          stop: [],
          num_predict: 2048,
          num_ctx: 4096,
          language: 'en',
          theme: 'system',
          hasDetectedLanguage: false,
          enterToSend: true,
          chatRetentionDays: 0,
          enableLatex: false,
          enableMermaid: true,
          density: 1.0,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  });

  it('initializes with required dependencies', () => {
    const { result } = renderHook(() => useChatActions());
    expect(result.current).toHaveProperty('sendMessage');
    expect(typeof result.current.sendMessage).toBe('function');
  });

  it('does not send message if no conversation selected', () => {
    vi.mocked(useCurrentConversationId).mockReturnValue(null);
    const { result } = renderHook(() => useChatActions());
    act(() => {
      result.current.sendMessage('test', [], []);
    });
    expect(chatApi.chat).not.toHaveBeenCalled();
  });

  it('does not send message if no model selected', () => {
    vi.mocked(useSelectedModel).mockReturnValue('');
    const { result } = renderHook(() => useChatActions());
    act(() => {
      result.current.sendMessage('test', [], []);
    });
    expect(chatApi.chat).not.toHaveBeenCalled();
  });

  it('does not send message if input is empty and no attachments', () => {
    const { result } = renderHook(() => useChatActions());
    act(() => {
      result.current.sendMessage(' ', [], []);
    });
    expect(chatApi.chat).not.toHaveBeenCalled();
  });

  it('sends message with valid input and calls chatApi', async () => {
    vi.mocked(useCurrentConversationId).mockReturnValue('conv1');
    const { result } = renderHook(() => useChatActions());
    await act(async () => {
      await result.current.sendMessage('Hello world', [], []);
    });
    expect(chatApi.chat).toHaveBeenCalled();
    expect(chatApi.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'llama3',
        baseUrl: 'http://localhost:11434',
        messages: [expect.objectContaining({ role: 'user', content: 'Hello world' })],
        options: expect.objectContaining({
          temperature: 0.7,
          stop: [],
          top_k: 40,
          top_p: 0.9,
          num_predict: 100,
          num_ctx: 2048,
        }),
        requestId: expect.any(String),
      })
    );
  });

  it('includes file attachments in prompt', async () => {
    const { result } = renderHook(() => useChatActions());
    await act(async () => {
      await result.current.sendMessage(
        'Check this',
        [],
        [{ name: 'file.txt', content: 'content', type: 'text/plain', size: 7 }]
      );
    });
    expect(chatApi.chat).toHaveBeenCalled();
  });

  it('handles chatApi failure gracefully', async () => {
    vi.mocked(chatApi.chat).mockRejectedValue(new Error('Connection failed'));
    const { result } = renderHook(() => useChatActions());
    await act(async () => {
      await result.current.sendMessage('test', [], []);
    });
    expect(chatApi.chat).toHaveBeenCalled();
  });

  it('does not send if conversation does not exist', () => {
    vi.mocked(useConversations).mockReturnValue({});
    const { result } = renderHook(() => useChatActions());
    act(() => {
      result.current.sendMessage('test', [], []);
    });
    expect(chatApi.chat).not.toHaveBeenCalled();
  });
});
