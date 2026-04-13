"use client";

import { useEffect } from 'react';
import { z } from 'zod';
import { useConversationStore, useModelStore, useSettingsStore } from '../../../store';
import { listen, invoke } from '../../../lib/ipc';
import {
  sanitizeError,
  BackendErrorSchema,
  PullProgressSchema,
  PullErrorSchema,
  OllamaModelSchema,
  OllamaTokenSchema,
  Message,
  OllamaToken,
  BackendError,
  PullProgress,
  PullError
} from '@musaed/contracts';
import toast from 'react-hot-toast';
import { logger } from '../../../lib/logger';

export function useTauriEvents() {
  const updatePullStatus = useModelStore(state => state.updatePullStatus);
  const setModels = useModelStore(state => state.setModels);

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

          // Only include metrics if they are actually provided in this chunk (usually the final one)
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
              const data = await invoke('get_ollama_models', {
                baseUrl: useSettingsStore.getState().globalSettings.ollamaUrl
              }, z.array(OllamaModelSchema));
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
