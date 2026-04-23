"use client";

import { useEffect } from 'react';
import { z } from 'zod';
import { useConversationStore, useSettingsStore } from '../../../store';
import { useUpdatePullStatus, useSetModels } from '../../../store/hooks';
import { listen, ollamaApi } from '../../../lib/ipc';
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
  PullError
} from '@musaed/contracts';
import toast from 'react-hot-toast';
import { logger } from '../../../lib/logger';

/**
 * Hook to listen for native Tauri events from the Rust backend.
 */
export function useTauriEvents() {
  const updatePullStatus = useUpdatePullStatus();
  const setModels = useSetModels();

  useEffect(() => {
    let unlisteners: (() => void)[] = [];
    let isMounted = true;

    const setup = async () => {
      const register = async <T>(event: string, schema: z.ZodType<T>, handler: (payload: T) => void) => {
        const un = await listen<T>(event, (payload) => isMounted && handler(payload), schema);
        unlisteners.push(un);
      };

      try {
        await register('ollama-token', OllamaTokenSchema, (payload: OllamaToken) => {
          const state = useConversationStore.getState();
          const requestId = payload.requestId;
          if (!requestId) return;

          const convId = Object.entries(state.activeStreams).find(([_, id]) => id === requestId)?.[0];
          if (!convId) return;

          const metrics: Partial<Message> = {};
          if (payload.eval_count != null) metrics.eval_count = payload.eval_count;
          if (payload.eval_duration != null) metrics.eval_duration = payload.eval_duration;
          if (payload.total_duration != null) metrics.total_duration = payload.total_duration;

          state.updateLastMessage(convId, {
            content: payload.message?.content ?? "",
            done: payload.done,
            ...metrics
          });

          if (payload.done) state.stopStream(convId);
        });

        await register('ollama-error', BackendErrorSchema, (payload: BackendError) => {
          const sanitized = sanitizeError(payload);
          const state = useConversationStore.getState();

          logger.error('Backend error event', { error: sanitized });

          if (sanitized.requestId) {
            const convId = Object.entries(state.activeStreams).find(([_, id]) => id === sanitized.requestId)?.[0];
            if (convId) {
              state.stopStream(convId);
              toast.error(sanitized.message);
              return;
            }
          }

          toast.error(sanitized.message);
          Object.keys(state.activeStreams).forEach(id => state.stopStream(id));
        });

        await register('pull-progress', PullProgressSchema, async (payload: PullProgress) => {
          const modelKey = payload.name || 'current';
          const progress = (payload.total && payload.completed != null)
            ? Math.round((payload.completed / payload.total) * 100)
            : undefined;

          updatePullStatus(modelKey, { status: payload.status, progress });

          if (payload.status === 'success') {
            const data = await ollamaApi.getModels(useSettingsStore.getState().globalSettings.ollamaUrl);

            if (data) setModels(data);
            setTimeout(() => isMounted && updatePullStatus(modelKey, null), 3000);
          }
        });

        await register('pull-error', PullErrorSchema, (payload: PullError) => {
          const modelKey = payload.name || 'current';
          updatePullStatus(modelKey, { status: 'error' });
          toast.error(payload.error || 'Model pull failed');
          setTimeout(() => isMounted && updatePullStatus(modelKey, null), 8000);
        });

      } catch (err) {
        logger.error('IPC initialization failure', { error: err });
      }
    };

    setup();
    return () => {
      isMounted = false;
      unlisteners.forEach(un => un());
    };
  }, [updatePullStatus, setModels]);
}