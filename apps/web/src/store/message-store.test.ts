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

  // ---------------------------------------------------------------------------
  // updateLastMessage
  // ---------------------------------------------------------------------------
  // The signature is `(conversationId, update, replace = false)`. When
  // `replace` is false (the default), `update.content` is APPENDED to the
  // existing content; when true, it REPLACES it. All other fields are spread
  // over the existing message in both modes.
  //
  // This dual-mode contract is load-bearing for flushAndStop + the streaming
  // store: `flushToConversation` clears `liveContent` on every call and
  // returns the DELTA that arrived since the prior flush (see
  // streaming-store.ts runFlushToConversation — "We intentionally do NOT
  // early-return when the conversation is already in `flushedStreams` …
  // Returning `{ content, metrics }` here lets the caller (flushAndStop →
  // updateLastMessage) append them"). The message store's last message is
  // therefore the accumulator, and flushAndStop MUST use append (the
  // default) — switching to `replace: true` would drop the first batch of
  // tokens when a second flush handles late-arriving tokens.
  //
  // `handleStreamError` in useChatStream.ts also relies on the append mode:
  // it calls `flushAndStop` (appends buffered partial tokens), then a manual
  // `updateLastMessage({ content: '\n\n[Error: …]', … }, false)` to append
  // the error prefix to whatever partial tokens were already written. Both
  // paths assume append is the default.
  describe('updateLastMessage', () => {
    it('appends update.content to the last message when replace is omitted', () => {
      const conv = 'conv-1';
      useMessageStore
        .getState()
        .setMessages(conv, [
          makeMessage('m1', 'user', 'hi'),
          makeMessage('m2', 'assistant', 'partial'),
        ]);

      useMessageStore.getState().updateLastMessage(conv, { content: 'hello' });

      const result = useMessageStore.getState().messages[conv];
      expect(result[1].content).toBe('partialhello');
    });

    it('appends update.content when replace is explicitly false', () => {
      const conv = 'conv-1';
      useMessageStore.getState().setMessages(conv, [makeMessage('m1', 'assistant', 'partial')]);

      useMessageStore.getState().updateLastMessage(conv, { content: 'more' }, false);

      expect(useMessageStore.getState().messages[conv][0].content).toBe('partialmore');
    });

    it('replaces content when replace is true', () => {
      const conv = 'conv-1';
      useMessageStore.getState().setMessages(conv, [makeMessage('m1', 'assistant', 'partial')]);

      useMessageStore.getState().updateLastMessage(conv, { content: 'full' }, true);

      expect(useMessageStore.getState().messages[conv][0].content).toBe('full');
    });

    it('treats undefined update.content as empty string in append mode (no-op append)', () => {
      const conv = 'conv-1';
      useMessageStore.getState().setMessages(conv, [makeMessage('m1', 'assistant', 'partial')]);

      // A patch that only sets e.g. `done: true` should not clobber or
      // truncate the accumulated content. This is how stopStream applies
      // its `stopped` marker patches after flushAndStop has run.
      useMessageStore.getState().updateLastMessage(conv, { done: true });

      const result = useMessageStore.getState().messages[conv][0];
      expect(result.content).toBe('partial');
      expect(result.done).toBe(true);
    });

    it('treats undefined update.content as preserving the existing content in replace mode', () => {
      const conv = 'conv-1';
      useMessageStore.getState().setMessages(conv, [makeMessage('m1', 'assistant', 'partial')]);

      // Per the ternary in updateLastMessage, `replace ? (update.content
      // ?? existing) : existing + (update.content ?? '')`. When replace is
      // true and update.content is undefined, the existing content is
      // kept — replace does NOT nuke content the patch didn't touch.
      useMessageStore.getState().updateLastMessage(conv, { done: true }, true);

      const result = useMessageStore.getState().messages[conv][0];
      expect(result.content).toBe('partial');
      expect(result.done).toBe(true);
    });

    it('accumulates across repeated append calls (mirrors flushAndStop late-token sequence)', () => {
      // Reproduces the sequence flushAndStop runs through when late tokens
      // arrive after a prior flush: first flush appends part1, a later
      // flushAndStop appends part2. The message store is the accumulator.
      const conv = 'conv-1';
      useMessageStore.getState().setMessages(conv, [makeMessage('m1', 'assistant', '')]);

      useMessageStore.getState().updateLastMessage(conv, { content: 'part1', done: true });
      useMessageStore.getState().updateLastMessage(conv, { content: 'part2', done: true });

      expect(useMessageStore.getState().messages[conv][0].content).toBe('part1part2');
    });

    it('spreads non-content fields onto the last message in append mode', () => {
      const conv = 'conv-1';
      useMessageStore.getState().setMessages(conv, [makeMessage('m1', 'assistant', 'partial')]);

      useMessageStore.getState().updateLastMessage(conv, {
        content: 'X',
        done: true,
        evalCount: 42,
        stopped: false,
      });

      const result = useMessageStore.getState().messages[conv][0];
      expect(result.content).toBe('partialX');
      expect(result.done).toBe(true);
      expect(result.evalCount).toBe(42);
      expect(result.stopped).toBe(false);
    });

    it('preserves existing message fields not present in the patch', () => {
      const conv = 'conv-1';
      const original: Message = {
        id: 'm1',
        role: 'assistant',
        content: 'partial',
        timestamp: 1000,
        model: 'test-model',
        requestId: 'req-1',
      };
      useMessageStore.getState().setMessages(conv, [original]);

      useMessageStore.getState().updateLastMessage(conv, { content: 'more', done: true });

      const result = useMessageStore.getState().messages[conv][0];
      expect(result.id).toBe('m1');
      expect(result.role).toBe('assistant');
      expect(result.timestamp).toBe(1000);
      expect(result.model).toBe('test-model');
      expect(result.requestId).toBe('req-1');
      expect(result.content).toBe('partialmore');
      expect(result.done).toBe(true);
    });

    it('mutates only the last message, leaving earlier messages unchanged', () => {
      const conv = 'conv-1';
      useMessageStore
        .getState()
        .setMessages(conv, [
          makeMessage('m1', 'user', 'hi'),
          makeMessage('m2', 'user', 'hello'),
          makeMessage('m3', 'assistant', 'partial'),
        ]);

      useMessageStore.getState().updateLastMessage(conv, { content: 'X', done: true });

      const result = useMessageStore.getState().messages[conv];
      expect(result.map((m) => m.content)).toEqual(['hi', 'hello', 'partialX']);
      expect(result[0].done).toBeUndefined();
      expect(result[1].done).toBeUndefined();
      expect(result[2].done).toBe(true);
    });

    it('is a no-op when the conversation has no messages in the store', () => {
      useMessageStore.getState().updateLastMessage('nonexistent', { content: 'x' });
      expect(useMessageStore.getState().messages['nonexistent']).toBeUndefined();
    });

    it('is a no-op when the message array is empty', () => {
      const conv = 'conv-1';
      useMessageStore.getState().setMessages(conv, []);

      useMessageStore.getState().updateLastMessage(conv, { content: 'x' });

      expect(useMessageStore.getState().messages[conv]).toEqual([]);
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
