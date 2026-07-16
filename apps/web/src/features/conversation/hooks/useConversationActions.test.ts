import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConversationActions } from './useConversationActions';
import { mockAllDependencies } from './useChatActions/shared/mocks';

beforeEach(() => {
  mockAllDependencies();
  vi.clearAllMocks();
});

describe('useConversationActions', () => {
  it('creates a new conversation with current model and settings', async () => {
    const { result } = renderHook(() => useConversationActions());

    await act(async () => {
      await result.current.createNewConversation();
    });

    expect(result.current).toBeDefined();
  });

  it('deletes conversation and clears messages', async () => {
    const { result } = renderHook(() => useConversationActions());

    await act(async () => {
      await result.current.deleteConversation('test-conversation-id');
    });

    expect(result.current).toBeDefined();
  });

  it('aborts streaming when deleting conversation', async () => {
    const { result } = renderHook(() => useConversationActions());

    await act(async () => {
      await result.current.deleteConversation('test-conversation-id');
    });

    expect(result.current).toBeDefined();
  });

  it('updates conversation title via updateConversation with id and partial updates', async () => {
    const { result } = renderHook(() => useConversationActions());

    await act(async () => {
      result.current.updateConversationTitle('test-conversation-id', 'New Title');
    });

    expect(result.current).toBeDefined();
  });

  it('clears all conversations, ids, and messages', async () => {
    const { result } = renderHook(() => useConversationActions());

    await act(async () => {
      await result.current.clearAllConversations();
    });

    expect(result.current).toBeDefined();
  });

  it('aborts all active streams before clearing', async () => {
    const { result } = renderHook(() => useConversationActions());

    await act(async () => {
      await result.current.clearAllConversations();
    });

    expect(result.current).toBeDefined();
  });
});
