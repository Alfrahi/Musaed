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
    // Cleans up the streaming store and decrements isStreaming via the
    // single coordination entry point.
    expect(mockUtils.coordination.stopStream).toHaveBeenCalledWith('conv1', 'error');
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

  it('bails out without appending error text when the stream was already resolved', () => {
    // Reproduces the race where the backend `ollama-error` event path
    // (useTauriEvents.handleError → stopStream('error')) wins and clears
    // activeStreams before the chatApi.chat promise-rejection path fires
    // handleStreamError. Without the resolved-stream guard, the late
    // handleStreamError would append a duplicate [Error: ...] prefix and
    // fire a second toast even though stopStream itself would bail.
    const { result } = renderHook(() => useChatStream());
    const updateLastMessage = vi.fn();
    const t = (key: string) => key;

    // Simulate the prior stopStream('error') having already cleared the stream
    const previous = mockStores.streamingStore.activeStreams;
    mockStores.streamingStore.activeStreams = {};

    act(() => {
      result.current.handleStreamError(new Error('boom'), 'conv1', 'req1', updateLastMessage, t);
    });

    expect(mockUtils.coordination.flushAndStop).not.toHaveBeenCalled();
    expect(updateLastMessage).not.toHaveBeenCalled();
    expect(mockUtils.coordination.stopStream).not.toHaveBeenCalled();
    expect(mockStores.uiStore.setErrorMessage).not.toHaveBeenCalled();

    // Restore for subsequent tests that expect `conv1` to be active
    mockStores.streamingStore.activeStreams = previous;
  });

  it('abortMessage delegates to stopStream for the given conversation', () => {
    const { result } = renderHook(() => useChatStream());

    act(() => {
      result.current.abortMessage('conv1');
    });

    // abortMessage reads the active requestId from the streaming store and
    // passes it to stopStream so the abort race guard can
    // bail out if the stream has been replaced.
    expect(mockUtils.coordination.stopStream).toHaveBeenCalledWith('conv1', 'abort', 'request1');
  });

  it('abortMessage is a no-op when conversationId is null', () => {
    const { result } = renderHook(() => useChatStream());

    act(() => {
      result.current.abortMessage(null);
    });

    expect(mockUtils.coordination.stopStream).not.toHaveBeenCalled();
  });
});
