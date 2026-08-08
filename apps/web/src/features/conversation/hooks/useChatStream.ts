'use client';

import { useCallback } from 'react';
import { type Message } from '@musaed/contracts';
import toast from 'react-hot-toast';
import { flushAndStop, stopStreamForConversation } from '@/store/coordination';
import { useStreamingStore } from '@/store/streaming-store';
import { useUIStore, useSetUIError } from '@/store/ui-store';
import { chatApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';

/**
 * Streaming lifecycle + stream-failure error handling for the chat send
 * pipeline. Extracted from the former God hook.
 *
 * `handleStreamError` flushes buffered tokens, marks the assistant message
 * with the error, clears the stream (without setting `stopped: true` — this
 * is a failure, not a user-initiated stop, and notifies the user.
 *
 * `abortMessage` calls `stopStreamForConversation` directly — the single
 * entry point that sends cmd_ollama_abort_chat, flushes buffered tokens,
 * and cleans up streaming state.
 */
export function useChatStream(): {
  handleStreamError: (
    err: unknown,
    conversationId: string,
    requestId: string,
    updateLastMessage: (id: string, update: Partial<Message>, replace: boolean) => void,
    t: (key: string) => string
  ) => void;
  abortMessage: (conversationId: string | null) => void;
} {
  const setErrorMessage = useSetUIError();

  const handleStreamError = useCallback(
    (
      err: unknown,
      conversationId: string,
      requestId: string,
      updateLastMessage: (id: string, update: Partial<Message>, replace: boolean) => void,
      t: (key: string) => string
    ) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Filter abort/cancellation errors so the user doesn't see a
      // "Stream failed" toast for a user-initiated or backend-canceled
      // stop. The backend may report "aborted",
      // "cancelled", "canceled", "Stream cancelled", "Request
      // cancelled", etc.
      const lower = msg.toLowerCase();
      if (['aborted', 'cancelled', 'canceled', 'cancel'].some((term) => lower.includes(term))) {
        return;
      }
      logger.error('Chat error', { error: msg, requestId });
      // Flush any buffered tokens before appending the error message
      flushAndStop(conversationId);
      updateLastMessage(
        conversationId,
        {
          content: `\n\n[${t('chat.errorPrefix')}: ${msg}]`,
          done: true,
          error: { code: 'STREAM_FAILED', message: msg },
        },
        false
      );
      // Clean up the streaming store without setting `stopped: true` — this is
      // a stream failure, not a user-initiated stop.
      useStreamingStore.getState().stopStream(conversationId);
      useStreamingStore.getState().clearStream(conversationId);
      const { activeStreams } = useStreamingStore.getState();
      if (Object.keys(activeStreams).length === 0) {
        useUIStore.getState().setStreaming(false);
      }
      setErrorMessage(msg);
      toast.error(msg);
    },
    [setErrorMessage]
  );

  const abortMessage = useCallback((conversationId: string | null) => {
    if (conversationId) {
      const requestId = useStreamingStore.getState().activeStreams[conversationId];
      if (requestId) chatApi.abort(requestId);
      // Pass the requestId we read so stopStreamForConversation can bail out
      // if a new stream has already replaced the old one between the read
      // above and this call (abort race).
      stopStreamForConversation(conversationId, requestId);
    }
  }, []);

  return { handleStreamError, abortMessage };
}
