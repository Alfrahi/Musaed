'use client';

import { useStreamingStore } from './stores/streaming-store';
import { useConversationStore } from './stores/conversation-store';

const BATCH_INTERVAL_MS = 500;
const timers: Record<string, ReturnType<typeof setInterval>> = {};

/**
 * Start batching tokens for a conversation.
 * Tokens accumulate in the streaming store; a periodic timer flushes them
 * to the conversation store at a capped rate.
 */
export function startBatching(conversationId: string): void {
  if (timers[conversationId]) return; // Already batching

  timers[conversationId] = setInterval(() => {
    flush(conversationId);
  }, BATCH_INTERVAL_MS);
}

/** Flush pending live content from the streaming store into the conversation store. */
function flush(conversationId: string): void {
  const result = useStreamingStore.getState().flushToConversation(conversationId);
  if (!result) return;

  useConversationStore.getState().updateLastMessage(conversationId, {
    content: result.content,
    ...result.metrics,
  });
}

/**
 * Immediately flush any remaining content and stop the batch timer.
 * Called when the stream completes (done=true) or on error.
 */
export function flushAndStop(conversationId: string): void {
  clearTimer(conversationId);
  flush(conversationId);
}

/** Stop batching without flushing (e.g., on abort). */
export function stopBatching(conversationId: string): void {
  clearTimer(conversationId);
  useStreamingStore.getState().clearStream(conversationId);
}

/** Stop all active batch timers and clear streaming buffers. */
export function stopAllBatching(): void {
  Object.keys(timers).forEach(stopBatching);
}

function clearTimer(conversationId: string): void {
  if (timers[conversationId]) {
    clearInterval(timers[conversationId]);
    delete timers[conversationId];
  }
}
