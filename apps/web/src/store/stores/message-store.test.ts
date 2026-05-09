import { describe, it, expect, beforeEach } from 'vitest';
import { useMessageStore } from './message-store';
import { type Message } from '@musaed/contracts';

describe('Message Store', () => {
  beforeEach(() => {
    useMessageStore.setState({
      messages: {},
    });
  });

  it('adds a message to a specific conversation', () => {
    const convId = 'test-id';
    const msg: Message = {
      id: 'm1',
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
    };

    useMessageStore.getState().addMessage(convId, msg);

    const msgs = useMessageStore.getState().messages[convId];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('hello');
  });

  it('updates the content of the last message (streaming simulation)', () => {
    const convId = 'test-id';
    const initialMsg: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'Hello',
      timestamp: Date.now(),
    };

    useMessageStore.setState({
      messages: { [convId]: [initialMsg] },
    });

    // Append mode
    useMessageStore.getState().updateLastMessage(convId, { content: ' world' });
    let msgs = useMessageStore.getState().messages[convId];
    expect(msgs[0].content).toBe('Hello world');

    // Replace mode
    useMessageStore.getState().updateLastMessage(convId, { content: 'New content' }, true);
    msgs = useMessageStore.getState().messages[convId];
    expect(msgs[0].content).toBe('New content');
  });

  it('clears messages for a conversation', () => {
    const convId = 'test-id';
    useMessageStore.setState({
      messages: { [convId]: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 0 }] },
    });

    useMessageStore.getState().clearMessages(convId);
    expect(useMessageStore.getState().messages[convId]).toBeUndefined();
  });
});
