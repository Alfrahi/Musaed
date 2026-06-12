'use client';

import { useStreamingStore } from './stores/streaming-store';
import { useMessageStore } from './stores/message-store';
import type { Message } from '@musaed/contracts';

/**
 * Flushes accumulated streaming content from the streaming buffer
 * into the message store, then stops the stream.
 *
 * This replaces the previous batch-manager that accumulated tokens
 * on a timer. Now that streaming tokens are handled directly by the
 * streaming store's live buffer, flush is only needed when a stream
 * ends (done or error) to commit the final content to the message store.
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
  }

  streamingStore.stopStream(conversationId);
}

/**
 * Stops batching for a conversation without flushing.
 * Used when aborting a stream where buffered content should be discarded.
 * Clears the liveContent and pendingMetrics buffers to prevent memory leaks.
 */
export function stopBatching(conversationId: string): void {
  const streamingStore = useStreamingStore.getState();
  streamingStore.stopStream(conversationId);
  streamingStore.clearStream(conversationId);
}
