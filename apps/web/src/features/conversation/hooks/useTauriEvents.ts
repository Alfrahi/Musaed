'use client';

import { useEffect } from 'react';
import { type z } from 'zod';

import { useSettingsStore } from '@/store/settings-store';
import { useStreamingStore } from '@/store/streaming-store';
import { listen } from '@/lib/ipc';
import { translate } from '@/lib/i18n';
import { stopStream } from '@/store/coordination';
import { useMessageStore } from '@/store/message-store';
import { triggerAutoTitle } from './useAutoTitle';
import { persistMessage } from '@/features/conversation/utils/message-persistence';
import {
  sanitizeError,
  BackendErrorSchema,
  OllamaTokenSchema,
  type Message,
  type OllamaToken,
  type BackendError,
} from '@musaed/contracts';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { bufferToken, setBulkFlush } from '@/lib/token-coalescer';

/** Handle incoming Ollama token events (streaming responses). */
const handleToken = (payload: OllamaToken) => {
  const streamingStore = useStreamingStore.getState();
  const requestId = payload.requestId;
  if (!requestId) return;

  const convId = Object.entries(streamingStore.activeStreams).find(
    ([_, id]) => id === requestId
  )?.[0];
  if (!convId) return;

  const token = payload.message?.content ?? '';

  // Buffer the token for the next rAF tick instead of mutating the store
  // on every token. `setPendingMetrics` stays synchronous because metrics
  // only need to be present at flush time, not per-token.
  bufferToken(convId, token, requestId);

  // Stash metrics so they're included in the next flush
  const metrics: Partial<Message> = {};
  if (payload.evalCount != null) metrics.evalCount = payload.evalCount;
  if (payload.promptEvalCount != null) metrics.promptEvalCount = payload.promptEvalCount;
  if (payload.evalDuration != null) metrics.evalDuration = payload.evalDuration;
  if (payload.totalDuration != null) metrics.totalDuration = payload.totalDuration;

  // Populate semantic token aliases alongside the legacy Ollama field names.
  // Ollama sends `eval_count`/`prompt_eval_count`; newer versions may use
  // `completion_tokens`/`prompt_tokens`/`total_tokens`. The Rust OllamaToken
  // struct deserializes either name into the same field; the TS schema has
  // both as optional. Here we normalize: prefer the semantic name if present,
  // fall back to the legacy name, and compute `totalTokens` when both parts
  // are available.
  const promptTokens = payload.promptTokens ?? payload.promptEvalCount ?? undefined;
  const completionTokens = payload.completionTokens ?? payload.evalCount ?? undefined;
  const totalTokens =
    payload.totalTokens ??
    (promptTokens != null && completionTokens != null
      ? promptTokens + completionTokens
      : undefined);
  if (promptTokens != null) metrics.promptTokens = promptTokens;
  if (completionTokens != null) metrics.completionTokens = completionTokens;
  if (totalTokens != null) metrics.totalTokens = totalTokens;

  if (Object.keys(metrics).length > 0) {
    streamingStore.setPendingMetrics(convId, requestId, metrics);
  }

  // On stream completion, flush remaining content + metrics and clean up.
  // Uses reason 'complete' (not 'abort') so the assistant message is NOT
  // marked `stopped:true` — that flag is reserved for user-initiated aborts.
  // This also ensures metrics are flushed onto the message for
  // TokenContextBar visualization.
  if (payload.done) {
    stopStream(convId, 'complete');

    // Persist the completed assistant message to Rust backend with retry logic.
    // Guard against the conversation being deleted between stream start and
    // completion: `messages[convId]` may be undefined if the
    // user deleted the conversation while the stream was still in flight.
    const msgs = useMessageStore.getState().messages[convId];
    const lastMsg = msgs?.[msgs.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      persistMessage(convId, lastMsg).then((result) => {
        if (!result.success) {
          const lang = useSettingsStore.getState().globalSettings.language;
          toast.error(translate('error.messageSaveFailed', lang));
          logger.error('Message persistence failed after retries', {
            conversationId: convId,
            messageId: lastMsg.id,
            role: lastMsg.role,
            retries: result.retries,
            error: result.error,
          });
        }
      });
    }

    // Auto-generate title only if the conversation still exists
    if (msgs?.length) {
      triggerAutoTitle(convId);
    }
  }
};

/** Handle backend error events. */
const handleError = (payload: BackendError) => {
  const sanitized = sanitizeError(payload);
  const streamingStore = useStreamingStore.getState();
  logger.error('Backend error event', { error: sanitized });
  const lang = useSettingsStore.getState().globalSettings.language;

  if (sanitized.requestId) {
    const convId = Object.entries(streamingStore.activeStreams).find(
      ([_, id]) => id === sanitized.requestId
    )?.[0];
    if (convId) {
      // Pass the requestId so stopStream bails out if a new stream has
      // replaced the old one before this call runs. Reason 'error' flushes
      // buffered tokens but does NOT mark the assistant message
      // `stopped: true` — that flag is reserved for user-initiated aborts
      // and would render a spurious "Stopped by user" marker on a message
      // that actually failed due to a backend error.
      stopStream(convId, 'error', sanitized.requestId);
      toast.error(translate('error.backendError', lang, { message: sanitized.message }));
      return;
    }
  }

  toast.error(translate('error.backendError', lang, { message: sanitized.message }));

  // Flush all active streams on unattributed errors. Use 'error' (not
  // 'abort') so the `stopped: true` marker stays reserved for
  // user-initiated stops.
  Object.keys(streamingStore.activeStreams).forEach((id) => {
    stopStream(id, 'error');
  });
};

/**
 * Hook to listen for native Tauri events from the Rust backend.
 */
export function useTauriEvents() {
  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    let isMounted = true;

    const register = async <T>(
      event: string,
      schema: z.ZodType<T>,
      handler: (payload: T) => void
    ) => {
      const un = await listen<T>(event, (payload) => isMounted && handler(payload), schema);
      unlisteners.push(un);
    };

    const setup = async () => {
      setBulkFlush((convId, text, reqId) => {
        useStreamingStore.getState().appendTokenBulk(convId, text, reqId);
      });
      try {
        await register('ollama-token', OllamaTokenSchema, handleToken);
        await register('ollama-error', BackendErrorSchema, handleError);
      } catch (err) {
        logger.error('IPC initialization failure', { error: err });
      }
    };

    setup();

    return () => {
      isMounted = false;
      setBulkFlush(() => {});
      unlisteners.forEach((un) => un());
    };
  }, []);
}
