// Tests for useAbortStreamsOnUnmount — aborts all active streams when the
// host (HomeClient) unmounts, so backend tasks don't stream into a dead
// listener set until completion/timeout.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from './shared/setup';
import { mockAllDependencies, mockIpc, mockStores, mockUtils } from './shared/mocks';

import { useAbortStreamsOnUnmount } from './useAbortStreamsOnUnmount';

beforeEach(() => {
  mockAllDependencies();
  vi.clearAllMocks();
  mockStores.streamingStore.activeStreams = { conv1: 'request1' };
});

describe('useAbortStreamsOnUnmount', () => {
  it('does nothing while mounted', () => {
    renderHook(() => useAbortStreamsOnUnmount());

    expect(mockIpc.chatApi.abort).not.toHaveBeenCalled();
    expect(mockUtils.coordination.stopStream).not.toHaveBeenCalled();
  });

  it('aborts every active stream on unmount', () => {
    mockStores.streamingStore.activeStreams = { conv1: 'request1', conv2: 'request2' };
    const { unmount } = renderHook(() => useAbortStreamsOnUnmount());

    unmount();

    expect(mockIpc.chatApi.abort).toHaveBeenCalledWith('request1');
    expect(mockIpc.chatApi.abort).toHaveBeenCalledWith('request2');
    // Passes the requestId through so a replaced stream makes stopStream bail.
    expect(mockUtils.coordination.stopStream).toHaveBeenCalledWith('conv1', 'abort', 'request1');
    expect(mockUtils.coordination.stopStream).toHaveBeenCalledWith('conv2', 'abort', 'request2');
  });

  it('is a no-op on unmount when no streams are active', () => {
    mockStores.streamingStore.activeStreams = {};
    const { unmount } = renderHook(() => useAbortStreamsOnUnmount());

    unmount();

    expect(mockIpc.chatApi.abort).not.toHaveBeenCalled();
    expect(mockUtils.coordination.stopStream).not.toHaveBeenCalled();
  });
});
