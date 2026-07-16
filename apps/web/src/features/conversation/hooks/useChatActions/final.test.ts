// Final test for useChatActions
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from './shared/setup';
import { useChatActions } from '../useChatActions';
import { mockIpc, mockStores, mockAllDependencies } from './shared/mocks';

// Simple test to verify the hook works
describe('useChatActions - Final Test', () => {
  beforeEach(() => {
    mockAllDependencies();
    vi.clearAllMocks();
  });

  it('should initialize and have required methods', () => {
    const { result } = renderHook(() => useChatActions());

    expect(result.current).toBeDefined();
    expect(result.current.sendMessage).toBeInstanceOf(Function);
    expect(result.current.abortMessage).toBeInstanceOf(Function);
  });

  it('should call addMessages when sending a message', async () => {
    const { result } = renderHook(() => useChatActions());

    // Override chatApi to resolve
    mockIpc.chatApi.chat.mockResolvedValue(true);

    await act(async () => {
      await result.current.sendMessage('test message');
    });

    expect(mockStores.messageStore.addMessages).toHaveBeenCalled();
    expect(mockIpc.chatApi.chat).toHaveBeenCalled();
  });
});
