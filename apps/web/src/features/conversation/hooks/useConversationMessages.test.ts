import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
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

// Mutable state for store mocks — tests configure these to drive the hook.
// The hook subscribes to `currentConversationId` reactively via
// `useCurrentConversationId()`, so flipping `mockCurrentConversationId`
// between `rerender` calls simulates the user switching conversations
// in the sidebar.
let mockCurrentConversationId: string | null = null;
let mockMessages: Record<string, Message[]> = {};
const mockSetMessages = vi.fn((conversationId: string, messages: Message[]) => {
  mockMessages = { ...mockMessages, [conversationId]: messages };
});

vi.mock('@/store/conversation-store', () => ({
  useCurrentConversationId: () => mockCurrentConversationId,
}));

vi.mock('@/store/message-store', () => {
  const getState = vi.fn(() => ({
    messages: mockMessages,
    setMessages: mockSetMessages,
  }));
  // The hook calls `useMessageStore.getState()` directly (a fresh read at
  // effect-run time is intentional here per the reactive-store feedback
  // note), so the mock must expose `getState` on the hook itself.
  const useMessageStore: any = vi.fn(() => getState());
  useMessageStore.getState = getState;
  return { useMessageStore };
});

const mockGetConversation = vi.fn();

vi.mock('@/lib/ipc', () => ({
  conversationApi: {
    getConversation: mockGetConversation,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeMessage(id: string, role: 'user' | 'assistant', content: string): Message {
  return {
    id,
    role,
    content,
    timestamp: Date.now(),
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

// Import AFTER mocks are installed so the hook sees the mocked modules.
const { useConversationMessages } = await import('./useConversationMessages');

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentConversationId = null;
  mockMessages = {};
  mockSetMessages.mockImplementation((conversationId: string, messages: Message[]) => {
    mockMessages = { ...mockMessages, [conversationId]: messages };
  });
});

describe('useConversationMessages', () => {
  it('fetches messages for the initial conversation on mount', async () => {
    const convAMessages = [
      makeMessage('m1', 'user', 'Hello A'),
      makeMessage('m2', 'assistant', 'Hi A'),
    ];
    mockGetConversation.mockResolvedValue(makeConversation('convA', convAMessages));
    mockCurrentConversationId = 'convA';

    renderHook(() => useConversationMessages());

    await waitFor(() => {
      expect(mockGetConversation).toHaveBeenCalledWith('convA');
      expect(mockSetMessages).toHaveBeenCalledWith('convA', convAMessages);
    });
  });

  it('does NOT fetch when currentConversationId is null', async () => {
    mockCurrentConversationId = null;

    renderHook(() => useConversationMessages());

    // Give the effect a chance to run (it should early-return).
    await new Promise((r) => setTimeout(r, 0));
    expect(mockGetConversation).not.toHaveBeenCalled();
    expect(mockSetMessages).not.toHaveBeenCalled();
  });

  it('skips fetch when messages are already cached in the store', async () => {
    mockCurrentConversationId = 'convA';
    mockMessages = { convA: [makeMessage('cached', 'user', 'cached')] };

    renderHook(() => useConversationMessages());

    await new Promise((r) => setTimeout(r, 0));
    expect(mockGetConversation).not.toHaveBeenCalled();
    expect(mockSetMessages).not.toHaveBeenCalled();
  });

  it('does NOT re-fetch a conversation already loaded in this session', async () => {
    const convAMessages = [makeMessage('m1', 'user', 'Hello A')];
    mockGetConversation.mockResolvedValue(makeConversation('convA', convAMessages));
    mockCurrentConversationId = 'convA';

    const { rerender } = renderHook(() => useConversationMessages());

    await waitFor(() => {
      expect(mockSetMessages).toHaveBeenCalledWith('convA', convAMessages);
    });

    // Switch away to B, then back to A — A should NOT be fetched again.
    mockGetConversation.mockClear();
    mockSetMessages.mockClear();
    mockCurrentConversationId = 'convB';
    rerender();

    await new Promise((r) => setTimeout(r, 0));
    expect(mockGetConversation).not.toHaveBeenCalledWith('convA');
  });

  // Regression test for the bug: the effect previously read
  // `currentConversationId` via `useConversationStore.getState()` with an
  // empty dependency array, so it only ran once on mount. Switching to a
  // second conversation never triggered a fetch.
  it('fetches messages again when the user switches conversations', async () => {
    const convAMessages = [makeMessage('mA1', 'user', 'Hello A')];
    const convBMessages = [
      makeMessage('mB1', 'user', 'Hello B'),
      makeMessage('mB2', 'assistant', 'Hi B'),
    ];
    mockGetConversation.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'convA'
          ? makeConversation('convA', convAMessages)
          : makeConversation('convB', convBMessages)
      )
    );

    // Start on conversation A.
    mockCurrentConversationId = 'convA';

    const { rerender } = renderHook(() => useConversationMessages());

    await waitFor(() => {
      expect(mockGetConversation).toHaveBeenCalledWith('convA');
      expect(mockSetMessages).toHaveBeenCalledWith('convA', convAMessages);
    });

    // Simulate user clicking conversation B in the sidebar.
    mockCurrentConversationId = 'convB';
    act(() => {
      rerender();
    });

    await waitFor(() => {
      expect(mockGetConversation).toHaveBeenCalledWith('convB');
      expect(mockSetMessages).toHaveBeenCalledWith('convB', convBMessages);
    });
  });

  it('logs a warning and does not set messages when getConversation fails', async () => {
    const { logger } = await import('@/lib/logger');
    mockGetConversation.mockRejectedValue(new Error('backend down'));
    mockCurrentConversationId = 'convA';

    renderHook(() => useConversationMessages());

    await waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to load messages for conversation',
        expect.objectContaining({ conversationId: 'convA' })
      );
    });
    expect(mockSetMessages).not.toHaveBeenCalled();
  });

  it('does not set messages after unmount cancels the in-flight fetch', async () => {
    let resolveFetch: (value: Conversation) => void = () => {};
    mockGetConversation.mockReturnValue(
      new Promise<Conversation>((resolve) => {
        resolveFetch = resolve;
      })
    );
    mockCurrentConversationId = 'convA';

    const { unmount } = renderHook(() => useConversationMessages());

    // Let the fetch kick off, then unmount before it resolves.
    await new Promise((r) => setTimeout(r, 0));
    unmount();
    resolveFetch(makeConversation('convA', [makeMessage('m1', 'user', 'too late')]));

    await new Promise((r) => setTimeout(r, 0));
    expect(mockSetMessages).not.toHaveBeenCalled();
  });
});
