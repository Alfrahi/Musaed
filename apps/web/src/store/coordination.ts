'use client';

/**
 * Cross-store coordination layer.
 *
 * Orchestrates state changes that span multiple stores by calling each
 * store's own public actions sequentially. Store modules must NOT import
 * each other directly — all cross-store side effects live here.
 */

import { useStreamingStore } from './stores/streaming-store';
import { useUIStore } from './stores/ui-store';
import { useConversationStore } from './stores/conversation-store';

/**
 * Start streaming for a conversation.
 *
 * 1. Registers the stream in the streaming store.
 * 2. Signals the UI store that at least one stream is active.
 */
export function coordinateStartStream(conversationId: string, requestId: string): void {
  useStreamingStore.getState().startStream(conversationId, requestId);
  useUIStore.getState().setStreaming(true);
}

/**
 * Stop streaming for a conversation.
 *
 * 1. Removes the stream from the streaming store.
 * 2. Updates the UI store's isStreaming flag based on remaining active streams.
 */
export function coordinateStopStream(conversationId: string): void {
  useStreamingStore.getState().stopStream(conversationId);
  const hasMoreStreams = Object.keys(useStreamingStore.getState().activeStreams).length > 0;
  useUIStore.getState().setStreaming(hasMoreStreams);
}

/**
 * Register a listener that signals the UI store when the conversation
 * store finishes persist rehydration. Safe to call after rehydration
 * has already completed (signals immediately in that case).
 *
 * @returns Cleanup function that removes the listener.
 */
export function registerHydrationCoordination(): () => void {
  if (useConversationStore.persist.hasHydrated()) {
    useUIStore.getState().setHydrated(true);
    return () => {};
  }

  return useConversationStore.persist.onFinishHydration(() => {
    useUIStore.getState().setHydrated(true);
  });
}
