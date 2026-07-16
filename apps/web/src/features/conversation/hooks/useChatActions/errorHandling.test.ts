// Tests for useChatActions error handling
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from './shared/setup';
import { useChatActions } from '../useChatActions';
import { mockIpc, mockUtils, mockStores, mockAllDependencies } from './shared/mocks';

beforeEach(() => {
  mockAllDependencies();
  vi.clearAllMocks();
});

describe('useChatActions - Error Handling', () => {
  it('handles chatApi failure gracefully', async () => {
    // Override chatApi to reject
    mockIpc.chatApi.chat.mockRejectedValue(new Error('API failure'));

    const { result } = renderHook(() => useChatActions());

    await act(async () => {
      try {
        await result.current.sendMessage('test message');
      } catch (_error) {
        // Expected error
      }
    });

    expect(mockStores.messageStore.updateLastMessage).toHaveBeenCalled();
  });

  it('logs error when persisting failed assistant message fails', async () => {
    // Override persistUserMessage to reject
    mockUtils.persistUserMessage.mockRejectedValue(new Error('Persist failure'));

    // Override chatApi to resolve (simulate successful chat but failed persist)
    mockIpc.chatApi.chat.mockResolvedValue(true);

    const { result } = renderHook(() => useChatActions());

    await act(async () => {
      await result.current.sendMessage('test message');
    });

    expect(mockUtils.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist assistant message'),
      expect.objectContaining({ error: expect.stringContaining('Persist failure') })
    );
  });
});
