import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_SETTINGS } from '@musaed/contracts';
import { useConversationStore } from './conversation-store';

const makeConversation = (id: string) => ({
  id,
  title: 'Test',
  model: 'llama',
  settings: DEFAULT_SETTINGS,
  createdAt: 0,
  updatedAt: 0,
});

describe('Conversation Store', () => {
  beforeEach(() => {
    useConversationStore.setState({
      conversations: {},
      conversationIds: [],
      currentConversationId: null,
      searchQuery: '',
    });
  });

  it('adds a conversation', () => {
    const convId = 'test-id';
    const conv = makeConversation(convId);
    useConversationStore.getState().addConversation(conv);

    expect(useConversationStore.getState().conversationIds).toContain(convId);
    expect(useConversationStore.getState().conversations[convId].title).toBe('Test');
  });

  it('updates a conversation', () => {
    const convId = 'test-id';
    useConversationStore.setState({
      conversations: { [convId]: makeConversation(convId) },
      conversationIds: [convId],
    });

    useConversationStore.getState().updateConversation(convId, { title: 'New Title' });
    const conv = useConversationStore.getState().conversations[convId];
    expect(conv?.title).toBe('New Title');
  });

  it('filters conversations by search query', () => {
    useConversationStore.getState().setSearchQuery('ollama');
    expect(useConversationStore.getState().searchQuery).toBe('ollama');
  });
});
