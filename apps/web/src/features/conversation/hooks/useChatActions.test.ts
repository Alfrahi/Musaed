'use client';

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useChatActions } from './useChatActions';

// --- Mocks ---
// All mock factories are self-contained (no external var refs) to avoid
// Vitest hoisting errors.

vi.mock('@/lib/ipc', () => ({
  chatApi: {
    chat: vi.fn().mockResolvedValue(true),
    abort: vi.fn().mockResolvedValue(undefined),
  },
  conversationApi: {
    createConversation: vi
      .fn()
      .mockImplementation((conversation: { id: string }) => Promise.resolve(conversation.id)),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    clearAllConversations: vi.fn().mockResolvedValue(undefined),
  },
  ragApi: {
    search: vi.fn().mockResolvedValue([]),
    assembleContext: vi.fn().mockResolvedValue({ assembledContext: '', citations: [] }),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/config', () => ({
  config: { isTest: true },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/store/batch-manager', () => ({
  flushAndStop: vi.fn(),
}));

vi.mock('@/store/ui-store', () => ({
  useSetUIError: vi.fn(() => vi.fn()),
}));

vi.mock('@/features/conversation/utils/message-persistence', () => ({
  persistUserMessage: vi.fn().mockResolvedValue(undefined),
}));

// Mock the sibling hook to avoid pulling its deep transitive store deps.
// vi.hoisted ensures the shared mock is available to the hoisted vi.mock factory.
const conversationActionsMock = vi.hoisted(() => ({
  initiateStreaming: vi.fn(),
  stopStreaming: vi.fn(),
  createNewConversation: vi.fn(),
  deleteConversation: vi.fn(),
  updateConversationTitle: vi.fn(),
  clearAllConversations: vi.fn(),
}));
vi.mock('./useConversationActions', () => ({
  useConversationActions: () => conversationActionsMock,
}));

vi.mock('@/features/conversation/store', () => {
  const messageStore = {
    addMessages: vi.fn(),
    updateLastMessage: vi.fn(),
    messages: {} as Record<string, unknown[]>,
  };
  return {
    useMessageStore: vi.fn(() => messageStore),
    useConversationStore: vi.fn(),
    useUpdateConversation: vi.fn(() => vi.fn()),
    useBatchUpdate: vi.fn(() => vi.fn()),
    useCurrentConversationId: vi.fn(() => 'test-conversation-id'),
    useConversations: vi.fn(() => ({
      'test-conversation-id': {
        id: 'test-conversation-id',
        title: 'Test',
        model: 'llama3.2:latest',
        settings: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    })),
    useStreamingStore: vi.fn(),
    selectLiveContent: vi.fn(),
    selectIsLiveStreaming: vi.fn(),
    selectActiveRequestId: vi.fn(),
    selectMessages: vi.fn(),
  };
});

vi.mock('@/features/settings/store/settings-store', () => ({
  useSettingsStore: vi.fn(() => ({
    globalSettings: {
      language: 'en',
      ollamaUrl: 'http://localhost:11434',
    },
  })),
  useLanguage: vi.fn(() => 'en'),
}));

vi.mock('@/features/settings/store/model-store', () => ({
  useModelStore: vi.fn(() => ({ selectedModel: 'llama3.2:latest' })),
}));

vi.mock('@/features/rag/store/rag-store', () => ({
  useRagStore: vi.fn(() => ({ activeProjectId: null, projects: {} })),
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// --- Tests ---

describe('useChatActions', () => {
  it('should send a message and call chatApi.chat', async () => {
    const { result } = renderHook(() => useChatActions());

    await act(async () => {
      await result.current.sendMessage('Hello, world!');
    });

    const { chatApi } = await import('@/lib/ipc');
    expect(chatApi.chat).toHaveBeenCalledTimes(1);
    expect(chatApi.chat).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:11434',
      messages: [{ role: 'user', content: 'Hello, world!' }],
      options: {
        temperature: 0.7,
        stop: [],
        topK: 40,
        topP: 0.9,
        numPredict: 100,
        numCtx: 2048,
      },
      model: 'llama3.2:latest',
      requestId: expect.any(String),
    });
  });

  it('should abort a message and call stopStreaming', async () => {
    const { result } = renderHook(() => useChatActions());

    await act(async () => {
      result.current.abortMessage();
    });

    expect(conversationActionsMock.stopStreaming).toHaveBeenCalledTimes(1);
    expect(conversationActionsMock.stopStreaming).toHaveBeenCalledWith('test-conversation-id');
  });
});
