// Tests for useChatActions RAG integration
import { describe, it, expect } from 'vitest';
import { renderHook, act } from './shared/setup';
import { useChatActions } from '../useChatActions';
import { mockIpc, mockStores } from './shared/mocks';

describe('useChatActions - RAG Integration', () => {
  it('continues when RAG context assembly fails', async () => {
    // Override RAG store to have an active project
    mockStores.ragStore.getState.mockReturnValue({
      activeProjectId: 'project1',
    });

    // Override RAG context assembly to reject
    mockIpc.ragApi.assembleContext.mockRejectedValue(new Error('RAG failure'));

    const { result } = renderHook(() => useChatActions());

    await act(async () => {
      await result.current.sendMessage('test message');
    });

    expect(mockStores.messageStore.addMessages).toHaveBeenCalled();
    expect(mockIpc.chatApi.chat).toHaveBeenCalled();
    // Should continue despite RAG failure
  });
});
