'use client';

import { useStreamingStore } from './stores/streaming-store';
import { useUIStore } from './stores/ui-store';
import { useSettingsStore } from './stores/settings-store';
import { useRagStore } from './stores/rag-store';
import { useMessageStore } from './stores/message-store';

import type { Message } from '@musaed/contracts';

/**
 * Coordinates streaming start/stop between the streaming store
 * and UI state (isStreaming flag).
 *
 * This replaces the previous coordination module that also handled
 * persistence batching. Now that persistence is handled by the Rust
 * backend, coordination only manages the streaming lifecycle.
 */

/**
 * Starts streaming for a conversation — marks the UI as streaming
 * and registers the stream in the streaming store.
 */
export function coordinateStartStream(conversationId: string, requestId: string): void {
  useUIStore.getState().setStreaming(true);
  useStreamingStore.getState().startStream(conversationId, requestId);
}

/**
 * Flushes any pending content from the streaming buffer to the message store,
 * then removes the conversation from active streams.
 *
 * This ensures buffered tokens are persisted before abort/stop so no content
 * is silently discarded.
 *
 * Idempotent: calling multiple times for the same conversationId is safe.
 */
export function flushAndStop(conversationId: string): void {
  const streamingStore = useStreamingStore.getState();
  const result = streamingStore.flushToConversation(conversationId);

  if (result) {
    const messageStore = useMessageStore.getState();
    const messages = messageStore.messages[conversationId] ?? [];

    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      const updatedMsg: Message = {
        ...lastMsg,
        content: lastMsg.content + result.content,
        ...result.metrics,
        done: true,
      };
      messageStore.setMessages(conversationId, [...messages.slice(0, -1), updatedMsg]);
    }

    // Mark as flushed to prevent duplicate flushes (race condition guard)
    streamingStore.markFlushed(conversationId);
  }

  streamingStore.stopStream(conversationId);
}

/**
 * Stops streaming for a conversation — flushes any remaining content,
 * clears the stream, and updates the UI flag if no other streams are active.
 */
export function coordinateStopStream(conversationId: string): void {
  useStreamingStore.getState().stopStream(conversationId);
  useStreamingStore.getState().clearStream(conversationId);

  // Only clear global streaming flag when no streams remain active
  const { activeStreams } = useStreamingStore.getState();
  if (Object.keys(activeStreams).length === 0) {
    useUIStore.getState().setStreaming(false);
  }
}

/**
 * Stops batching for a conversation without flushing.
 * Used when aborting a stream where buffered content should be discarded.
 * Clears the liveContent and pendingMetrics buffers to prevent memory leaks.
 */
export function stopBatching(conversationId: string): void {
  useStreamingStore.getState().stopStream(conversationId);
  useStreamingStore.getState().clearStream(conversationId);
}

const STORES_TO_HYDRATE = 2;

/**
 * Triggers async rehydration for all persisted stores that use skipHydration.
 * Each store's onRehydrateStorage callback will call UIStore.onStoreRehydrated(),
 * which decrements the pending counter. When it reaches 0, isHydrated is set true.
 */
export function registerHydrationCoordination(): () => void {
  let disposed = false;

  const { isHydrated } = useUIStore.getState();

  if (!isHydrated) {
    useUIStore.getState().setPendingRehydrations(STORES_TO_HYDRATE);
    useSettingsStore.persist.rehydrate();
    useRagStore.persist.rehydrate();
  }

  return () => {
    if (disposed) return;
    disposed = true;
  };
}
