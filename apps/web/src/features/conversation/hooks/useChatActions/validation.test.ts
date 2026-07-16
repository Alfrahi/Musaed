// Tests for useChatActions validation
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from './shared/setup';
import { useChatActions } from '../useChatActions';
import { mockStores } from './shared/mocks';

describe('useChatActions - Validation', () => {
  it('does not send message if no conversation selected', async () => {
    // Override current conversation ID to be null
    mockStores.conversationStore.getState.mockReturnValue({
      conversations: [],
      currentConversationId: null,
      updateConversation: vi.fn(),
    });

    const { result } = renderHook(() => useChatActions());

    await act(async () => {
      await result.current.sendMessage('test message');
    });

    expect(mockStores.messageStore.addMessage).not.toHaveBeenCalled();
  });

  it('does not send message if no model selected', async () => {
    // Override selected model to be null
    mockStores.modelStore.getState.mockReturnValue({
      selectedModel: null,
    });

    const { result } = renderHook(() => useChatActions());

    await act(async () => {
      await result.current.sendMessage('test message');
    });

    expect(mockStores.messageStore.addMessage).not.toHaveBeenCalled();
  });

  it('does not send message if input is empty and no attachments', async () => {
    const { result } = renderHook(() => useChatActions());

    await act(async () => {
      await result.current.sendMessage('');
    });

    expect(mockStores.messageStore.addMessage).not.toHaveBeenCalled();
  });

  it('does not send if conversation does not exist', async () => {
    // Override conversations to be empty
    mockStores.conversationStore.getState.mockReturnValue({
      conversations: [],
      currentConversationId: 'nonexistent',
      updateConversation: vi.fn(),
    });

    const { result } = renderHook(() => useChatActions());

    await act(async () => {
      await result.current.sendMessage('test message');
    });

    expect(mockStores.messageStore.addMessage).not.toHaveBeenCalled();
  });
});
