// Tests for useChatActions message sending
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from './shared/setup';
import { useChatActions } from '../useChatActions';
import { mockIpc, mockStores, mockAllDependencies } from './shared/mocks';

beforeEach(() => {
  mockAllDependencies();
  vi.clearAllMocks();
});

describe('useChatActions - Message Sending', () => {
  it('sends message with valid input and calls chatApi', async () => {
    const { result } = renderHook(() => useChatActions());

    await act(async () => {
      await result.current.sendMessage('test message');
    });

    expect(mockStores.messageStore.addMessages).toHaveBeenCalled();
    expect(mockIpc.chatApi.chat).toHaveBeenCalled();
    expect(mockStores.streamingStore.startStream).toHaveBeenCalled();
  });

  it('includes file attachments in prompt', async () => {
    const { result } = renderHook(() => useChatActions());

    // Mock file attachments
    const mockFiles = [{ name: 'test.txt', content: 'file content', size: 12, type: 'text/plain' }];

    await act(async () => {
      await result.current.sendMessage('test message', [], mockFiles);
    });

    expect(mockStores.messageStore.addMessages).toHaveBeenCalled();
    expect(mockIpc.chatApi.chat).toHaveBeenCalled();
    // Verify attachments are included in the prompt with formatted content
    const callArgs = mockIpc.chatApi.chat.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain('File: test.txt');
    expect(callArgs.messages[0].content).toContain('Content:');
    expect(callArgs.messages[0].content).toContain('File Context:');
    expect(callArgs.messages[0].content).toContain('file content');
  });
});
