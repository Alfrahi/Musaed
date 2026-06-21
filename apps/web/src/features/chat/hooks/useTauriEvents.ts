'use client';

import { useEffect } from 'react';
import { type z } from 'zod';

import { useSettingsStore } from '../../settings/store/settings-store';
import { useStreamingStore } from '../store/streaming-store';
import { useModelStore } from '../../settings/store/model-store';
import { listen, ollamaApi } from '../../../lib/ipc';
import { flushAndStop } from '../../../store/batch-manager';
import { coordinateStopStream } from '../../../store/coordination';
import { useMessageStore } from '../store/message-store';
import { triggerAutoTitle } from './useAutoTitle';
import { persistMessage } from '../../../lib/message-persistence';
import {
  sanitizeError,
  BackendErrorSchema,
  PullProgressSchema,
  PullErrorSchema,
  OllamaTokenSchema,
  type Message,
  type OllamaToken,
  type BackendError,
  type PullProgress,
  type PullError,
} from '@musaed/contracts';
import toast from 'react-hot-toast';
import { logger } from '../../../lib/logger';

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
  const _isFirstToken = !(convId in streamingStore.liveContent);

  // Accumulate token in the lightweight streaming buffer
  streamingStore.appendToken(convId, token);

  // Stash metrics so they're included in the next flush
  const metrics: Partial<Message> = {};
  if (payload.evalCount != null) metrics.evalCount = payload.evalCount;
  if (payload.evalDuration != null) metrics.evalDuration = payload.evalDuration;
  if (payload.totalDuration != null) metrics.totalDuration = payload.totalDuration;
  if (Object.keys(metrics).length > 0) {
    streamingStore.setPendingMetrics(convId, metrics);
  }

  // On stream completion, flush remaining content immediately and stop
  if (payload.done) {
    flushAndStop(convId);
    coordinateStopStream(convId);

    // Persist the completed assistant message to Rust backend with retry logic
    const msgs = useMessageStore.getState().messages[convId] ?? [];
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      persistMessage(convId, lastMsg).then((result) => {
        if (!result.success) {
          toast.error('Failed to save message to history');
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

    // Auto-generate title for conversations that still have the default title
    triggerAutoTitle(convId);
  }
};

/** Handle backend error events. */
const handleError = (payload: BackendError) => {
  const sanitized = sanitizeError(payload);
  const streamingStore = useStreamingStore.getState();
  logger.error('Backend error event', { error: sanitized });

  if (sanitized.requestId) {
    const convId = Object.entries(streamingStore.activeStreams).find(
      ([_, id]) => id === sanitized.requestId
    )?.[0];
    if (convId) {
      flushAndStop(convId);
      coordinateStopStream(convId);
      toast.error(sanitized.message);
      return;
    }
  }

  toast.error(sanitized.message);

  // Flush all active streams on unattributed errors
  Object.keys(streamingStore.activeStreams).forEach((id) => {
    flushAndStop(id);
    coordinateStopStream(id);
  });
};

/** Create pull-progress event handler. */
const createPullProgressHandler =
  (isMountedRef: () => boolean) => async (payload: PullProgress) => {
    const modelKey = payload.name || 'current';
    const progress =
      payload.total && payload.completed != null
        ? Math.round((payload.completed / payload.total) * 100)
        : undefined;
    useModelStore.getState().updatePullStatus(modelKey, { status: payload.status, progress });
    if (payload.status === 'success') {
      const data = await ollamaApi.getModels(useSettingsStore.getState().globalSettings.ollamaUrl);
      if (data) useModelStore.getState().setModels(data);
      setTimeout(
        () => isMountedRef() && useModelStore.getState().updatePullStatus(modelKey, null),
        3000
      );
    }
  };

/** Create pull-error event handler. */
const createPullErrorHandler = (isMountedRef: () => boolean) => (payload: PullError) => {
  const modelKey = payload.name || 'current';
  useModelStore.getState().updatePullStatus(modelKey, { status: 'error' });
  toast.error(payload.error || 'Model pull failed');
  setTimeout(
    () => isMountedRef() && useModelStore.getState().updatePullStatus(modelKey, null),
    8000
  );
};

/**
 * Hook to listen for native Tauri events from the Rust backend.
 */
export function useTauriEvents() {
  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    let isMounted = true;
    const isMountedRef = () => isMounted;

    const register = async <T>(
      event: string,
      schema: z.ZodType<T>,
      handler: (payload: T) => void
    ) => {
      const un = await listen<T>(event, (payload) => isMounted && handler(payload), schema);
      unlisteners.push(un);
    };

    const setup = async () => {
      try {
        await register('ollama-token', OllamaTokenSchema, handleToken);
        await register('ollama-error', BackendErrorSchema, handleError);
        await register(
          'pull-progress',
          PullProgressSchema,
          createPullProgressHandler(isMountedRef)
        );
        await register('pull-error', PullErrorSchema, createPullErrorHandler(isMountedRef));
      } catch (err) {
        logger.error('IPC initialization failure', { error: err });
      }
    };

    setup();

    return () => {
      isMounted = false;
      unlisteners.forEach((un) => un());
    };
  }, []);
}
