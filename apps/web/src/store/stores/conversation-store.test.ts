import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_SETTINGS } from '@musaed/contracts';
import { useConversationStore } from './conversation-store';

const makeConversation = (
  id: string,
  messages: { id: string; role: 'user' | 'assistant'; content: string; timestamp: number }[]
) => ({
  id,
  title: 'Test',
  messages,
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
      activeStreams: {},
      searchQuery: '',
    });
  });

  it('adds a message to a specific conversation', () => {
    const convId = 'test-id';
    useConversationStore.setState({
      conversations: { [convId]: makeConversation(convId, []) },
      conversationIds: [convId],
    });

    const msg = { id: 'm1', role: 'user' as const, content: 'hello', timestamp: Date.now() };
    useConversationStore.getState().addMessage(convId, msg as any);

    const conv = useConversationStore.getState().conversations[convId];
    expect(conv?.messages).toHaveLength(1);
    expect(conv?.messages[0].content).toBe('hello');
  });

  it('updates the content of the last message (streaming simulation)', () => {
    const convId = 'test-id';
    const initialMsg = {
      id: 'm1',
      role: 'assistant' as const,
      content: 'Hello',
      timestamp: Date.now(),
    };

    useConversationStore.setState({
      conversations: { [convId]: makeConversation(convId, [initialMsg]) },
      conversationIds: [convId],
    });

    // Append mode
    useConversationStore.getState().updateLastMessage(convId, { content: ' world' });
    let conv = useConversationStore.getState().conversations[convId];
    expect(conv?.messages[0].content).toBe('Hello world');

    // Replace mode
    useConversationStore.getState().updateLastMessage(convId, { content: 'New content' }, true);
    conv = useConversationStore.getState().conversations[convId];
    expect(conv?.messages[0].content).toBe('New content');
  });

  it('filters conversations by search query', () => {
    useConversationStore.getState().setSearchQuery('ollama');
    expect(useConversationStore.getState().searchQuery).toBe('ollama');
  });
});
