'use client';

import { useEffect } from 'react';
import { z } from 'zod';
import { useConversationStore, useSettingsStore } from '../../../store';
import { useStreamingStore } from '../../../store/stores/streaming-store';
import { startBatching, flushAndStop, stopAllBatching } from '../../../store/batch-manager';
import { persistConversationsNow } from '../../../store/stores/conversation-store';
import { useUpdatePullStatus, useSetModels } from '../../../store/hooks';
import { listen, ollamaApi } from '../../../lib/ipc';
import { triggerAutoTitle } from './useAutoTitle';
import {
  sanitizeError,
  BackendErrorSchema,
  PullProgressSchema,
  PullErrorSchema,
  OllamaTokenSchema,
  Message,
  OllamaToken,
  BackendError,
  PullProgress,
  PullError,
} from '@musaed/contracts';
import toast from 'react-hot-toast';
import { logger } from '../../../lib/logger';

/** Handle incoming Ollama token events (streaming responses). */
const handleToken = (payload: OllamaToken) => {
  const state = useConversationStore.getState();
  const requestId = payload.requestId;
  if (!requestId) return;

  const convId = Object.entries(state.activeStreams).find(([_, id]) => id === requestId)?.[0];
  if (!convId) return;

  const token = payload.message?.content ?? '';
  const streamingStore = useStreamingStore.getState();
  const isFirstToken = !(convId in streamingStore.liveContent);

  // Accumulate token in the lightweight streaming buffer
  streamingStore.appendToken(convId, token);

  // Stash metrics so they're included in the next batch flush
  const metrics: Partial<Message> = {};
  if (payload.eval_count != null) metrics.eval_count = payload.eval_count;
  if (payload.eval_duration != null) metrics.eval_duration = payload.eval_duration;
  if (payload.total_duration != null) metrics.total_duration = payload.total_duration;
  if (Object.keys(metrics).length > 0) {
    streamingStore.setPendingMetrics(convId, metrics);
  }

  // Start the batch timer on the first token if not already running
  if (isFirstToken) {
    startBatching(convId);
  }

  // On stream completion, flush remaining content immediately and stop
  if (payload.done) {
    flushAndStop(convId);
    state.stopStream(convId);

    // Auto-generate title for conversations that still have the default title
    triggerAutoTitle(convId);
  }
};

/** Handle backend error events. */
const handleError = (payload: BackendError) => {
  const sanitized = sanitizeError(payload);
  const state = useConversationStore.getState();

  logger.error('Backend error event', { error: sanitized });

  if (sanitized.requestId) {
    const convId = Object.entries(state.activeStreams).find(
      ([_, id]) => id === sanitized.requestId
    )?.[0];
    if (convId) {
      flushAndStop(convId);
      state.stopStream(convId);
      toast.error(sanitized.message);
      return;
    }
  }

  toast.error(sanitized.message);
  // Flush all active streams on unattributed errors
  Object.keys(state.activeStreams).forEach((id) => {
    flushAndStop(id);
    state.stopStream(id);
  });
};

/** Create pull-progress event handler. */
const createPullProgressHandler =
  (
    updatePullStatus: (key: string, status: { status: string; progress?: number } | null) => void,
    setModels: (
      models: {
        name: string;
        size?: number | null;
        digest?: string | null;
        details?: {
          format?: string | null;
          family?: string | null;
          parameter_size?: string | null;
          quantization_level?: string | null;
        } | null;
      }[]
    ) => void,
    isMountedRef: () => boolean
  ) =>
  async (payload: PullProgress) => {
    const modelKey = payload.name || 'current';
    const progress =
      payload.total && payload.completed != null
        ? Math.round((payload.completed / payload.total) * 100)
        : undefined;

    updatePullStatus(modelKey, { status: payload.status, progress });

    if (payload.status === 'success') {
      const data = await ollamaApi.getModels(useSettingsStore.getState().globalSettings.ollamaUrl);
      if (data) setModels(data);
      setTimeout(() => isMountedRef() && updatePullStatus(modelKey, null), 3000);
    }
  };

/** Create pull-error event handler. */
const createPullErrorHandler =
  (
    updatePullStatus: (key: string, status: { status: string } | null) => void,
    isMountedRef: () => boolean
  ) =>
  (payload: PullError) => {
    const modelKey = payload.name || 'current';
    updatePullStatus(modelKey, { status: 'error' });
    toast.error(payload.error || 'Model pull failed');
    setTimeout(() => isMountedRef() && updatePullStatus(modelKey, null), 8000);
  };

/**
 * Hook to listen for native Tauri events from the Rust backend.
 */
export function useTauriEvents() {
  const updatePullStatus = useUpdatePullStatus();
  const setModels = useSetModels();

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
          createPullProgressHandler(updatePullStatus, setModels, isMountedRef)
        );
        await register(
          'pull-error',
          PullErrorSchema,
          createPullErrorHandler(updatePullStatus, isMountedRef)
        );
      } catch (err) {
        logger.error('IPC initialization failure', { error: err });
      }
    };

    setup();
    return () => {
      isMounted = false;
      stopAllBatching();
      persistConversationsNow();
      unlisteners.forEach((un) => un());
    };
  }, [updatePullStatus, setModels]);
}
