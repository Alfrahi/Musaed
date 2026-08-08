import { describe, it, expect, beforeEach } from 'vitest';
import { useMessageStore } from './message-store';
import { type Message } from '@musaed/contracts';

describe('useMessageStore', () => {
  beforeEach(() => {
    useMessageStore.getState().clearAllMessages();
  });

  const makeMessage = (id: string, role: 'user' | 'assistant' = 'user', content = ''): Message => ({
    id,
    role,
    content,
    timestamp: Date.now(),
  });

  describe('updateMessage', () => {
    it('updates the content of a specific message by id', () => {
      const conv = 'conv-1';
      const msgs = [makeMessage('m1'), makeMessage('m2')];
      useMessageStore.getState().setMessages(conv, msgs);
      useMessageStore.getState().updateMessage(conv, 'm1', { content: 'updated' });

      const result = useMessageStore.getState().messages[conv];
      expect(result[0].content).toBe('updated');
      expect(result[1].content).toBe('');
    });

    it('applies a partial patch without removing other fields', () => {
      const conv = 'conv-1';
      const msg: Message = {
        id: 'm1',
        role: 'user',
        content: 'original',
        timestamp: 1000,
        model: 'test-model',
      };
      useMessageStore.getState().setMessages(conv, [msg]);
      useMessageStore.getState().updateMessage(conv, 'm1', { done: true });

      const result = useMessageStore.getState().messages[conv][0];
      expect(result.content).toBe('original');
      expect(result.model).toBe('test-model');
      expect(result.done).toBe(true);
    });

    it('is a no-op when the message id does not exist', () => {
      const conv = 'conv-1';
      useMessageStore.getState().setMessages(conv, [makeMessage('m1')]);
      useMessageStore.getState().updateMessage(conv, 'nonexistent', { content: 'x' });

      const result = useMessageStore.getState().messages[conv];
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('');
    });

    it('is a no-op when the conversation has no messages in the store', () => {
      useMessageStore.getState().updateMessage('nonexistent', 'm1', { content: 'x' });
      expect(useMessageStore.getState().messages['nonexistent']).toBeUndefined();
    });
  });

  describe('removeMessage', () => {
    it('removes a single message by id', () => {
      const conv = 'conv-1';
      const msgs = [makeMessage('m1'), makeMessage('m2'), makeMessage('m3')];
      useMessageStore.getState().setMessages(conv, msgs);
      useMessageStore.getState().removeMessage(conv, 'm2');

      const result = useMessageStore.getState().messages[conv];
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(['m1', 'm3']);
    });

    it('is a no-op when the message id does not exist', () => {
      const conv = 'conv-1';
      useMessageStore.getState().setMessages(conv, [makeMessage('m1')]);
      useMessageStore.getState().removeMessage(conv, 'nonexistent');

      expect(useMessageStore.getState().messages[conv]).toHaveLength(1);
    });

    it('is a no-op when the conversation has no messages in the store', () => {
      useMessageStore.getState().removeMessage('nonexistent', 'm1');
      expect(useMessageStore.getState().messages['nonexistent']).toBeUndefined();
    });
  });
});
