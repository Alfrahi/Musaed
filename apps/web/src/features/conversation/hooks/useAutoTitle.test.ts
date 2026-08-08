import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerAutoTitle, pendingAutoTitles } from './useAutoTitle';
import * as titleGenerator from '@/features/conversation/utils/title-generator';

// Mutable state for store mocks - allows tests to configure return values
let mockConversationState: any = {};
let mockMessageState: any = {};
let mockSettingsState: any = {};

// Mock stores according to feedback guidelines
vi.mock('@/store/conversation-store', () => {
  const mockUpdateConversation = vi.fn();
  const getState = vi.fn(() => ({
    conversations: mockConversationState,
    updateConversation: mockUpdateConversation,
  }));
  const useConversationStore: any = vi.fn(() => getState());
  useConversationStore.getState = getState;
  return { useConversationStore };
});

vi.mock('@/store/message-store', () => {
  const getState = vi.fn(() => ({
    messages: mockMessageState,
  }));
  const useMessageStore: any = vi.fn(() => getState());
  useMessageStore.getState = getState;
  return { useMessageStore };
});

vi.mock('@/store/settings-store', () => {
  const getState = vi.fn(() => ({
    globalSettings: mockSettingsState,
  }));
  const useSettingsStore: any = vi.fn(() => getState());
  useSettingsStore.getState = getState;
  return { useSettingsStore };
});

vi.mock('@/lib/ipc', () => ({
  conversationApi: {
    updateConversation: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('triggerAutoTitle', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    pendingAutoTitles.clear();

    // Set up title generator mock
    vi.spyOn(titleGenerator, 'generateConversationTitle').mockResolvedValue('Generated Title');
    vi.spyOn(titleGenerator, 'isDefaultTitle').mockImplementation(
      (title: string) => title === 'New Chat'
    );

    // Set up conversation store with conv123
    mockConversationState = {
      conv123: {
        id: 'conv123',
        title: 'New Chat',
        model: 'llama3',
        settings: {
          ollamaUrl: 'http://localhost:11434',
          language: 'en',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };

    mockMessageState = {
      conv123: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ],
    };

    mockSettingsState = { ollamaUrl: 'http://localhost:11434', language: 'en' };
  });

  it('generates and updates title when defaults are present', async () => {
    const conversationStore = await import('@/store/conversation-store');
    const getStateMock = conversationStore.useConversationStore.getState;
    const mockUpdate = (getStateMock() as any).updateConversation;

    await triggerAutoTitle('conv123');

    expect(titleGenerator.generateConversationTitle).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith('conv123', {
      title: 'Generated Title',
    });
  });

  it('does nothing if conversation already has custom title', async () => {
    vi.mocked(titleGenerator.isDefaultTitle).mockImplementation(() => false);

    await triggerAutoTitle('conv123');

    expect(titleGenerator.generateConversationTitle).not.toHaveBeenCalled();
  });

  it('returns early if already pending (same conversation instance)', async () => {
    pendingAutoTitles.add(`conv123:${mockConversationState.conv123.createdAt}`);

    await triggerAutoTitle('conv123');

    expect(titleGenerator.generateConversationTitle).not.toHaveBeenCalled();
    pendingAutoTitles.clear();
  });

  it('does NOT treat a recycled id as the same pending request', async () => {
    // Simulate: original conversation (createdAt T1) is pending; a new
    // conversation reuses the same id with createdAt T2. The two should be
    // treated as distinct pending entries so the new conversation can still
    // generate a title.
    const t1 = mockConversationState.conv123.createdAt;
    pendingAutoTitles.add(`conv123:${t1}`);

    // New conversation with the same id but a later createdAt
    const t2 = t1 + 10_000;
    mockConversationState.conv123 = {
      ...mockConversationState.conv123,
      createdAt: t2,
      updatedAt: t2,
    };

    await triggerAutoTitle('conv123');

    expect(titleGenerator.generateConversationTitle).toHaveBeenCalled();
    pendingAutoTitles.clear();
  });

  it('discards generated title when conversation is replaced mid-flight', async () => {
    // Race scenario: lookup finds conversation A (createdAt T1); while the
    // title is being generated, conversation A is deleted and a new
    // conversation B reuses the id with createdAt T2. The title generated
    // from A's messages MUST NOT be applied to B.
    const t1 = mockConversationState.conv123.createdAt;
    const t2 = t1 + 10_000;

    // Make title generation async so we can mutate the store mid-flight.
    let resolveTitle: (value: string | null) => void = () => {};
    const titlePromise = new Promise<string | null>((r) => {
      resolveTitle = r;
    });
    vi.spyOn(titleGenerator, 'generateConversationTitle').mockReturnValue(titlePromise);

    const conversationStore = await import('@/store/conversation-store');
    const getStateMock = conversationStore.useConversationStore.getState as ReturnType<
      typeof vi.fn
    >;
    const mockUpdateConversation = vi.fn();
    // First call (lookup) returns A; subsequent calls see B until title resolves.
    getStateMock.mockImplementation(() => ({
      conversations: {
        conv123: {
          ...mockConversationState.conv123,
          createdAt: t1,
          updatedAt: t1,
        },
      },
      updateConversation: mockUpdateConversation,
    }));

    const pending = triggerAutoTitle('conv123');

    // Mid-flight: replace conversation A with conversation B (same id, new createdAt).
    getStateMock.mockImplementation(() => ({
      conversations: {
        conv123: {
          ...mockConversationState.conv123,
          createdAt: t2,
          updatedAt: t2,
        },
      },
      updateConversation: mockUpdateConversation,
    }));

    resolveTitle('Title from conversation A');
    await pending;

    // Title generated from A's messages must NOT be applied to conversation B.
    expect(mockUpdateConversation).not.toHaveBeenCalled();
    pendingAutoTitles.clear();
  });

  it('handles retry loop when conversation missing initially', async () => {
    const loggerModule = await import('@/lib/logger');
    const mockLogger = loggerModule.logger;
    const conversationStore = await import('@/store/conversation-store');
    const getStateMock = conversationStore.useConversationStore.getState as ReturnType<
      typeof vi.fn
    >;
    const mockUpdateConversation = vi.fn();

    // First two attempts return empty, third returns the conversation
    getStateMock
      .mockReturnValueOnce({ conversations: {}, updateConversation: mockUpdateConversation })
      .mockReturnValueOnce({ conversations: {}, updateConversation: mockUpdateConversation })
      .mockReturnValueOnce({
        conversations: {
          conv123: {
            id: 'conv123',
            title: 'New Chat',
            model: 'llama3',
            settings: {
              ollamaUrl: 'http://localhost:11434',
              language: 'en',
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
        updateConversation: mockUpdateConversation,
      })
      // Additional calls for message store, settings, and final update check
      .mockReturnValue({
        conversations: {
          conv123: {
            id: 'conv123',
            title: 'New Chat',
            model: 'llama3',
            settings: {
              ollamaUrl: 'http://localhost:11434',
              language: 'en',
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
        updateConversation: mockUpdateConversation,
      });

    await triggerAutoTitle('conv123');

    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    expect(titleGenerator.generateConversationTitle).toHaveBeenCalled();
    expect(mockUpdateConversation).toHaveBeenCalledWith('conv123', {
      title: 'Generated Title',
    });
  });
});
