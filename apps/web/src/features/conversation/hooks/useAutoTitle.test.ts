import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerAutoTitle, pendingAutoTitles } from './useAutoTitle';
import * as titleGenerator from '@/features/conversation/utils/title-generator';

// Mutable state for store mocks - allows tests to configure return values
let mockConversationState: any = {};
let mockMessageState: any = {};
let mockSettingsState: any = {};

// Mock stores according to feedback guidelines
vi.mock('@/features/conversation/store/conversation-store', () => {
  const mockUpdateConversation = vi.fn();
  const getState = vi.fn(() => ({
    conversations: mockConversationState,
    updateConversation: mockUpdateConversation,
  }));
  const useConversationStore: any = vi.fn(() => getState());
  useConversationStore.getState = getState;
  return { useConversationStore };
});

vi.mock('@/features/conversation/store/message-store', () => {
  const getState = vi.fn(() => ({
    messages: mockMessageState,
  }));
  const useMessageStore: any = vi.fn(() => getState());
  useMessageStore.getState = getState;
  return { useMessageStore };
});

vi.mock('@/features/settings/store/settings-store', () => {
  const getState = vi.fn(() => ({
    globalSettings: mockSettingsState,
  }));
  const useSettingsStore: any = vi.fn(() => getState());
  useSettingsStore.getState = getState;
  return { useSettingsStore };
});

vi.mock('@/features/conversation/utils/conversation-backend', () => ({
  backendUpdateConversation: vi.fn().mockResolvedValue(true),
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
    const conversationStore = await import('@/features/conversation/store/conversation-store');
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

  it('returns early if already pending', async () => {
    const loggerModule = await import('@/lib/logger');
    pendingAutoTitles.add('conv123');

    await triggerAutoTitle('conv123');

    expect(loggerModule.logger.warn).not.toHaveBeenCalled();
    pendingAutoTitles.delete('conv123');
  });

  it('handles retry loop when conversation missing initially', async () => {
    const loggerModule = await import('@/lib/logger');
    const mockLogger = loggerModule.logger;
    const conversationStore = await import('@/features/conversation/store/conversation-store');
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

    expect(mockLogger.warn).toHaveBeenCalledTimes(3);
    expect(titleGenerator.generateConversationTitle).toHaveBeenCalled();
    expect(mockUpdateConversation).toHaveBeenCalledWith('conv123', {
      title: 'Generated Title',
    });
  });
});
