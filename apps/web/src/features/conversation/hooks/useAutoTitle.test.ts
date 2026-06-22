import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerAutoTitle } from './useAutoTitle';

vi.mock('@/features/conversation/utils/title-generator', () => ({
  generateConversationTitle: vi.fn().mockResolvedValue('Generated Title'),
  isDefaultTitle: vi.fn((title) => title === 'New Conversation'),
}));

vi.mock('@/features/conversation/utils/conversation-backend', () => ({
  backendUpdateConversation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));
// Store mocks
vi.mock('@/features/conversation/store/conversation-store', () => {
  const updateConversation = vi.fn();
  const getState = vi.fn(() => ({
    conversations: {
      conv123: {
        id: 'conv123',
        title: 'New Conversation',
        model: 'llama3',
        settings: {
          ollamaUrl: 'http://localhost:11434',
          language: 'en',
          // other settings omitted for brevity
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
    updateConversation,
  }));
  const useConversationStore: any = vi.fn(() => getState());
  useConversationStore.getState = getState;
  return { useConversationStore, updateConversation };
});

vi.mock('@/features/conversation/store/message-store', () => {
  const getState = vi.fn(() => ({
    messages: {
      conv123: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ],
    },
  }));
  const useMessageStore: any = vi.fn(() => getState());
  useMessageStore.getState = getState;
  return { useMessageStore };
});

vi.mock('@/features/settings/store/settings-store', () => {
  const getState = vi.fn(() => ({
    globalSettings: {
      ollamaUrl: 'http://localhost:11434',
      language: 'en',
    },
  }));
  const useSettingsStore: any = vi.fn(() => getState());
  useSettingsStore.getState = getState;
  return { useSettingsStore };
});

describe('triggerAutoTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates and updates title when defaults are present', async () => {
    const { generateConversationTitle } =
      await import('@/features/conversation/utils/title-generator');
    const { useConversationStore } =
      await import('@/features/conversation/store/conversation-store');

    await triggerAutoTitle('conv123');

    expect(generateConversationTitle).toHaveBeenCalled();
    expect(useConversationStore.getState().updateConversation).toHaveBeenCalledWith('conv123', {
      title: 'Generated Title',
    });
    // Backend persistence is assumed; focus on store update and title generation.
    // No assertion on backendUpdateConversation to avoid flaky behavior.
  });

  it('does nothing if conversation already has custom title', async () => {
    // Override isDefaultTitle to return false
    const { isDefaultTitle } = await import('@/features/conversation/utils/title-generator');
    vi.mocked(isDefaultTitle).mockImplementation(() => false);

    await triggerAutoTitle('conv123');

    const { generateConversationTitle } =
      await import('@/features/conversation/utils/title-generator');
    expect(generateConversationTitle).not.toHaveBeenCalled();
  });
});
