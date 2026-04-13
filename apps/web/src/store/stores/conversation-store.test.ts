import { describe, it, expect, beforeEach } from 'vitest';
import { useConversationStore } from './conversation-store';

describe('Conversation Store', () => {
  beforeEach(() => {
    useConversationStore.setState({
      conversations: [],
      currentConversationId: null,
      activeStreams: {},
      searchQuery: '',
    });
  });

  it('adds a message to a specific conversation', () => {
    const convId = 'test-id';
    useConversationStore.setState({
      conversations: [{ id: convId, title: 'Test', messages: [], model: 'llama', createdAt: 0, updatedAt: 0 } as any]
    });

    const msg = { id: 'm1', role: 'user', content: 'hello', timestamp: Date.now() };
    useConversationStore.getState().addMessage(convId, msg as any);

    const conv = useConversationStore.getState().conversations.find(c => c.id === convId);
    expect(conv?.messages).toHaveLength(1);
    expect(conv?.messages[0].content).toBe('hello');
  });

  it('updates the content of the last message (streaming simulation)', () => {
    const convId = 'test-id';
    const initialMsg = { id: 'm1', role: 'assistant', content: 'Hello', timestamp: Date.now() };
    
    useConversationStore.setState({
      conversations: [{ id: convId, title: 'Test', messages: [initialMsg], model: 'llama', createdAt: 0, updatedAt: 0 } as any]
    });

    // Append mode
    useConversationStore.getState().updateLastMessage(convId, { content: ' world' });
    let conv = useConversationStore.getState().conversations.find(c => c.id === convId);
    expect(conv?.messages[0].content).toBe('Hello world');

    // Replace mode
    useConversationStore.getState().updateLastMessage(convId, { content: 'New content' }, true);
    conv = useConversationStore.getState().conversations.find(c => c.id === convId);
    expect(conv?.messages[0].content).toBe('New content');
  });

  it('filters conversations by search query', () => {
    useConversationStore.getState().setSearchQuery('ollama');
    expect(useConversationStore.getState().searchQuery).toBe('ollama');
  });
});