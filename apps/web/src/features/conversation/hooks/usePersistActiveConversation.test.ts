import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mutable state the mock reads. Tests mutate this to drive reactive rerenders.
let mockCurrentConversationId: string | null = null;

vi.mock('@/store/conversation-store', () => ({
  useCurrentConversationId: () => mockCurrentConversationId,
}));

import {
  getLastActiveConversationId,
  setLastActiveConversationId,
} from '../utils/last-active-conversation';

const { usePersistActiveConversation } = await import('./usePersistActiveConversation');

beforeEach(() => {
  mockCurrentConversationId = null;
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('usePersistActiveConversation', () => {
  it('persists the current conversation id to localStorage on mount', () => {
    mockCurrentConversationId = 'conv-1';

    renderHook(() => usePersistActiveConversation());

    expect(getLastActiveConversationId()).toBe('conv-1');
  });

  it('updates localStorage when currentConversationId changes', () => {
    mockCurrentConversationId = 'conv-1';
    const { rerender } = renderHook(() => usePersistActiveConversation());

    expect(getLastActiveConversationId()).toBe('conv-1');

    mockCurrentConversationId = 'conv-2';
    act(() => rerender());

    expect(getLastActiveConversationId()).toBe('conv-2');
  });

  it('clears localStorage when currentConversationId becomes null', () => {
    mockCurrentConversationId = 'conv-1';
    setLastActiveConversationId('conv-1');
    const { rerender } = renderHook(() => usePersistActiveConversation());

    mockCurrentConversationId = null;
    act(() => rerender());

    expect(getLastActiveConversationId()).toBeNull();
  });

  it('does not write when currentConversationId is null on mount', () => {
    mockCurrentConversationId = null;
    setLastActiveConversationId('stale-value');

    renderHook(() => usePersistActiveConversation());

    expect(getLastActiveConversationId()).toBeNull();
  });
});
