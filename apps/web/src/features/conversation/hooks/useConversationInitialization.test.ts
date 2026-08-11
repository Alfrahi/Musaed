import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Conversation, Message } from '@musaed/contracts';

const TEST_SETTINGS = {
  temperature: 0.7,
  topK: 40,
  topP: 0.9,
  numPredict: 2048,
  numCtx: 4096,
  stop: [],
  systemPrompt: '',
  ollamaUrl: 'http://localhost:11434',
  language: 'en' as const,
  theme: 'system' as const,
  hasDetectedLanguage: false,
  enterToSend: true,
  chatRetentionDays: 0,
  enableLatex: false,
  enableMermaid: true,
  density: 1.0,
  sidebarWidth: 260,
  sidebarCollapsed: false,
  closeToTray: true,
  showTokenIndicator: true,
};

// --- Mutable mock state ---
let mockStoreState: Record<string, unknown> = {};
const mockBatchUpdate = vi.fn(
  (updater: (state: typeof mockStoreState) => Record<string, unknown>) => {
    // Simulate zustand's `set` semantics: shallow-merge result back into state.
    const partial = updater(mockStoreState);
    mockStoreState = { ...mockStoreState, ...partial };
  }
);
const mockCreateNewConversation = vi.fn();

vi.mock('@/store/conversation-store', () => ({
  useConversationStore: Object.assign(
    vi.fn(() => ({
      currentConversationId: null,
    })),
    {
      getState: () => ({
        batchUpdate: mockBatchUpdate,
      }),
    }
  ),
}));

let mockMessages: Record<string, Message[]> = {};
const mockSetMessages = vi.fn((conversationId: string, messages: Message[]) => {
  mockMessages = { ...mockMessages, [conversationId]: messages };
});

vi.mock('@/store/message-store', () => {
  const getState = vi.fn(() => ({ setMessages: mockSetMessages }));
  const useMessageStore: any = vi.fn(() => getState());
  useMessageStore.getState = getState;
  return { useMessageStore };
});

const mockListConversations = vi.fn();
const mockGetConversation = vi.fn();

vi.mock('@/lib/ipc', () => ({
  conversationApi: {
    getConversation: mockGetConversation,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// useConversationActions is imported from './useConversationActions' —
// we stub it so the hook constructs without dragging in the wider action
// graph (model store, settings store, backend create, etc.).
vi.mock('./useConversationActions', () => ({
  useConversationActions: () => ({
    createNewConversation: mockCreateNewConversation,
  }),
}));

// initializeConversations goes through conversationApi.listConversations
// internally — mock the util itself to isolate init logic. Tests vary by
// returning different ConversationMetadata[] arrays.
vi.mock('../utils/conversation-backend', () => ({
  initializeConversations: mockListConversations,
}));

import { getLastActiveConversationId } from '../utils/last-active-conversation';

const { useConversationInitialization } = await import('./useConversationInitialization');

interface Metadata {
  id: string;
  title: string | null;
  model: string | null;
  settings: typeof TEST_SETTINGS;
  createdAt: number;
  updatedAt: number;
}

function makeMetadata(id: string, updatedAt = Date.now()): Metadata {
  return {
    id,
    title: `title-${id}`,
    model: 'llama3',
    settings: TEST_SETTINGS,
    createdAt: updatedAt,
    updatedAt,
  };
}

function makeConversation(id: string, messages: Message[]): Conversation {
  return {
    id,
    title: id,
    messages,
    model: 'llama3',
    settings: TEST_SETTINGS,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeMessage(id: string, role: 'user' | 'assistant', content: string): Message {
  return { id, role, content, timestamp: Date.now() };
}

beforeEach(() => {
  mockStoreState = {};
  mockMessages = {};
  localStorage.clear();
  mockBatchUpdate.mockClear();
  mockCreateNewConversation.mockClear();
  mockSetMessages.mockClear();
  mockGetConversation.mockReset();
  mockListConversations.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useConversationInitialization', () => {
  it('restores the last active conversation from localStorage when it exists', async () => {
    const c1 = makeMetadata('c1', 1000);
    const c2 = makeMetadata('c2', 5000);
    const c3 = makeMetadata('c3', 2000);
    // Backend returns most-recent-first (updated_at DESC).
    mockListConversations.mockResolvedValue([c2, c3, c1]);
    mockGetConversation.mockResolvedValue(makeConversation('c1', []));
    localStorage.setItem('lastActiveConversationId', 'c1');

    const { result } = renderHook(() => useConversationInitialization());

    await act(async () => {
      await result.current.initialize();
    });

    // currentConversationId should be c1 (persisted), not c2 (most recent).
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    const updater = mockBatchUpdate.mock.calls[0][0] as (s: unknown) => {
      currentConversationId: string;
    };
    expect(updater({}).currentConversationId).toBe('c1');
    // The persisted id should also have been re-confirmed (or touched).
    expect(getLastActiveConversationId()).toBe('c1');
  });

  it('falls back to conversations[0] when lastActiveConversationId is stale (not in backend list)', async () => {
    const c2 = makeMetadata('c2', 5000);
    const c3 = makeMetadata('c3', 2000);
    mockListConversations.mockResolvedValue([c2, c3]);
    mockGetConversation.mockResolvedValue(makeConversation('c2', []));
    localStorage.setItem('lastActiveConversationId', 'deleted-conv');

    const { result } = renderHook(() => useConversationInitialization());

    await act(async () => {
      await result.current.initialize();
    });

    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    const updater = mockBatchUpdate.mock.calls[0][0] as (s: unknown) => {
      currentConversationId: string;
    };
    // Stale persisted id should not be used; falls back to conversations[0].
    expect(updater({}).currentConversationId).toBe('c2');
    // Stale persisted id should be overwritten with the new active id.
    expect(getLastActiveConversationId()).toBe('c2');
  });

  it('loads messages for the restored (not the most recent) conversation', async () => {
    const c1 = makeMetadata('c1', 1000);
    const c2 = makeMetadata('c2', 5000);
    mockListConversations.mockResolvedValue([c2, c1]);
    const c1Messages = [makeMessage('m1', 'user', 'hi')];
    mockGetConversation.mockResolvedValue(makeConversation('c1', c1Messages));
    localStorage.setItem('lastActiveConversationId', 'c1');

    const { result } = renderHook(() => useConversationInitialization());

    await act(async () => {
      await result.current.initialize();
    });

    expect(mockGetConversation).toHaveBeenCalledWith('c1');
    expect(mockSetMessages).toHaveBeenCalledWith('c1', c1Messages);
  });

  it('falls back to conversations[0] when no persisted id is present', async () => {
    const c2 = makeMetadata('c2', 5000);
    mockListConversations.mockResolvedValue([c2]);
    mockGetConversation.mockResolvedValue(makeConversation('c2', []));

    const { result } = renderHook(() => useConversationInitialization());

    await act(async () => {
      await result.current.initialize();
    });

    expect(mockGetConversation).toHaveBeenCalledWith('c2');
    expect(getLastActiveConversationId()).toBe('c2');
  });

  it('calls createNewConversation when there are no conversations', async () => {
    mockListConversations.mockResolvedValue([]);

    const { result } = renderHook(() => useConversationInitialization());

    await act(async () => {
      await result.current.initialize();
    });

    expect(mockCreateNewConversation).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('calls createNewConversation when listConversations returns null', async () => {
    mockListConversations.mockResolvedValue(null);

    const { result } = renderHook(() => useConversationInitialization());

    await act(async () => {
      await result.current.initialize();
    });

    expect(mockCreateNewConversation).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('survives a getConversation failure (logs warning, does not throw)', async () => {
    const c2 = makeMetadata('c2', 5000);
    mockListConversations.mockResolvedValue([c2]);
    mockGetConversation.mockRejectedValue(new Error('backend down'));

    const { result } = renderHook(() => useConversationInitialization());
    const { logger } = await import('@/lib/logger');

    await act(async () => {
      await result.current.initialize();
    });

    await waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to load messages for initial conversation',
        expect.anything()
      );
    });
    expect(mockSetMessages).not.toHaveBeenCalled();
  });
});
