'use client';

import { useCallback } from 'react';
import { type Message } from '@musaed/contracts';
import toast from 'react-hot-toast';
import { stopStream, flushAndStop } from '@/store/coordination';
import { useStreamingStore } from '@/store/streaming-store';
import { useSetUIError } from '@/store/ui-store';
import { chatApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';

/**
 * Streaming lifecycle + stream-failure error handling for the chat send
 * pipeline. Extracted from the former God hook.
 *
 * `handleStreamError` flushes buffered tokens (via `flushAndStop` so the
 * error-prefix content can be appended to whatever partial tokens are
 * already on the assistant message), marks the assistant message with the
 * error, then routes the stream shutdown through `stopStream('error')` so
 * the streaming store + global `isStreaming` flag are cleaned up by the
 * single coordination entry point. It deliberately does NOT set the
 * `stopped: true` marker — this is a failure, not a user-initiated stop.
 *
 * **Resolved-stream guard**: Bails out (after the abort-filter) when the
 * conversation is no longer in `activeStreams` — a prior `stopStream` call
 * (e.g. the backend `ollama-error` event path in `useTauriEvents.handleError`
 * winning the race) already flushed buffered tokens and tore down the stream.
 * Without this guard, a late `handleStreamError` firing from the
 * `chatApi.chat` promise-rejection path would append a duplicate error
 * prefix and fire a second toast, even though `stopStream` itself would
 * correctly bail via the resolution guard. This mirrors the first-writer-wins
 * semantic already established in `stopStream` so both error paths agree.
 *
 * `abortMessage` routes through `stopStream('abort')` — the single entry
 * point that flushes buffered tokens, marks the message `stopped: true`,
 * and cleans up streaming state. Callers must call `chatApi.abort(requestId)`
 * before invoking it — `stopStream` does not initiate IPC.
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
      // Resolved-stream guard: if the conversation is no longer in
      // `activeStreams`, a prior `stopStream` call already resolved this
      // stream (e.g. the backend `ollama-error` event path in
      // `useTauriEvents.handleError` won the race and flushed + cleared
      // the stream). Bail out instead of appending a duplicate error prefix
      // and firing a second toast — `stopStream`'s own resolution guard
      // would make the trailing `stopStream` call a no-op anyway, but the
      // `updateLastMessage` + `toast.error` calls below run before it and
      // are not guarded there. Mirrors the first-writer-wins semantic.
      if (!(conversationId in useStreamingStore.getState().activeStreams)) return;
      logger.error('Chat error', { error: msg, requestId });
      // Flush any buffered tokens before appending the error message —
      // this mutates the assistant message in-place so the error prefix
      // can be appended to whatever partial tokens are already showing.
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
      // Route the cleanup through the single coordination entry point with
      // reason 'error' — no `stopped: true` marker (this is a failure, not
      // a user-initiated stop). `stopStream` clears the streaming store
      // and decrements `isStreaming` if no other streams remain.
      stopStream(conversationId, 'error');
      setErrorMessage(msg);
      toast.error(msg);
    },
    [setErrorMessage]
  );

  const abortMessage = useCallback((conversationId: string | null) => {
    if (conversationId) {
      const requestId = useStreamingStore.getState().activeStreams[conversationId];
      if (requestId) chatApi.abort(requestId);
      // Pass the requestId we read so stopStream can bail out if a new
      // stream has already replaced the old one between the read above
      // and this call (abort race).
      stopStream(conversationId, 'abort', requestId);
    }
  }, []);

  return { handleStreamError, abortMessage };
}
