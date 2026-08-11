import { describe, it, expect, beforeEach } from 'vitest';

const { getLastActiveConversationId, setLastActiveConversationId, clearLastActiveConversationId } =
  await import('./last-active-conversation');

beforeEach(() => {
  localStorage.clear();
});

describe('last-active-conversation', () => {
  it('round-trips a conversation id through localStorage', () => {
    setLastActiveConversationId('conv-1');
    expect(getLastActiveConversationId()).toBe('conv-1');
  });

  it('overwrites the previous persisted id', () => {
    setLastActiveConversationId('conv-1');
    setLastActiveConversationId('conv-2');
    expect(getLastActiveConversationId()).toBe('conv-2');
  });

  it('returns null when nothing has been persisted', () => {
    expect(getLastActiveConversationId()).toBeNull();
  });

  it('clearLastActiveConversationId removes the persisted id', () => {
    setLastActiveConversationId('conv-1');
    clearLastActiveConversationId();
    expect(getLastActiveConversationId()).toBeNull();
  });

  it('clearLastActiveConversationId is a no-op when nothing is persisted', () => {
    expect(() => clearLastActiveConversationId()).not.toThrow();
    expect(getLastActiveConversationId()).toBeNull();
  });
});
