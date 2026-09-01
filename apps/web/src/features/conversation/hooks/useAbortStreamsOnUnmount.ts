'use client';

import { useEffect } from 'react';
import { stopStream } from '@/store/coordination';
import { useStreamingStore } from '@/store/streaming-store';
import { chatApi } from '@/lib/ipc';

/**
 * Aborts every active chat stream when the host component unmounts (window
 * close / reload / navigation away from the chat view). Without this, the
 * backend task keeps streaming to completion against a dead listener set —
 * it self-cleans eventually, but only after running to the end or hitting
 * the absolute stream timeout.
 *
 * Mounted once in HomeClient; other in-app flows (stop button, delete,
 * clear-all) abort through their own paths and never reach this cleanup
 * because HomeClient stays mounted.
 */
export function useAbortStreamsOnUnmount(): void {
  useEffect(() => {
    return () => {
      const activeStreams = useStreamingStore.getState().activeStreams;
      Object.entries(activeStreams).forEach(([conversationId, requestId]) => {
        chatApi.abort(requestId);
        // Pass the requestId so stopStream bails out if a new stream has
        // replaced the old one before this call runs.
        stopStream(conversationId, 'abort', requestId);
      });
    };
  }, []);
}
