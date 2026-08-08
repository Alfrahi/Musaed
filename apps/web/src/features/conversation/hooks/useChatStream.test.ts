// Tests for useChatStream — stream-failure error handling + abort.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from './shared/setup';
import { mockAllDependencies, mockStores, mockUtils } from './shared/mocks';

import { useChatStream } from './useChatStream';

beforeEach(() => {
  mockAllDependencies();
  vi.clearAllMocks();
});

describe('useChatStream', () => {
  it('initializes with handleStreamError and abortMessage functions', () => {
    const { result } = renderHook(() => useChatStream());

    expect(result.current.handleStreamError).toBeInstanceOf(Function);
    expect(result.current.abortMessage).toBeInstanceOf(Function);
  });

  it('flushes, marks message, clears stream, and toasts on stream error', () => {
    const { result } = renderHook(() => useChatStream());
    const updateLastMessage = vi.fn();
    const t = (key: string) => key;

    act(() => {
      result.current.handleStreamError(new Error('boom'), 'conv1', 'req1', updateLastMessage, t);
    });

    // Flushes buffered tokens before appending the error
    expect(mockUtils.coordination.flushAndStop).toHaveBeenCalledWith('conv1');
    // Marks the assistant message with the error content + done flag
    expect(updateLastMessage).toHaveBeenCalledWith(
      'conv1',
      {
        content: '\n\n[chat.errorPrefix: boom]',
        done: true,
        error: { code: 'STREAM_FAILED', message: 'boom' },
      },
      false
    );
    // Cleans up the streaming store (failure, not user-stop — no `stopped: true`)
    expect(mockStores.streamingStore.stopStream).toHaveBeenCalledWith('conv1');
    expect(mockStores.streamingStore.clearStream).toHaveBeenCalledWith('conv1');
    // Notifies the user
    expect(mockStores.uiStore.setErrorMessage).toHaveBeenCalledWith('boom');
  });

  it('is a no-op when the error is an abort', () => {
    const { result } = renderHook(() => useChatStream());
    const updateLastMessage = vi.fn();
    const t = (key: string) => key;

    act(() => {
      result.current.handleStreamError(new Error('aborted'), 'conv1', 'req1', updateLastMessage, t);
    });

    expect(mockUtils.coordination.flushAndStop).not.toHaveBeenCalled();
    expect(updateLastMessage).not.toHaveBeenCalled();
  });

  it('abortMessage delegates to stopStreamForConversation for the given conversation', () => {
    const { result } = renderHook(() => useChatStream());

    act(() => {
      result.current.abortMessage('conv1');
    });

    // abortMessage reads the active requestId from the streaming store and
    // passes it to stopStreamForConversation so the abort race guard can
    // bail out if the stream has been replaced.
    expect(mockUtils.coordination.stopStreamForConversation).toHaveBeenCalledWith(
      'conv1',
      'request1'
    );
  });

  it('abortMessage is a no-op when conversationId is null', () => {
    const { result } = renderHook(() => useChatStream());

    act(() => {
      result.current.abortMessage(null);
    });

    expect(mockUtils.coordination.stopStreamForConversation).not.toHaveBeenCalled();
  });
});
