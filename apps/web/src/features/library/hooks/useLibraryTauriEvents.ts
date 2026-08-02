'use client';

import { useEffect } from 'react';
import { type z } from 'zod';

import { useModelStore } from '@/store/model-store';
import { useSettingsStore } from '@/store/settings-store';
import { listen, ollamaApi } from '@/lib/ipc';
import { translate } from '@/lib/i18n';
import {
  PullProgressSchema,
  PullErrorSchema,
  type PullProgress,
  type PullError,
} from '@musaed/contracts';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

/** Create pull-progress event handler. */
const createPullProgressHandler =
  (isMountedRef: () => boolean) => async (payload: PullProgress) => {
    const modelKey = payload.name || 'current';
    const progress =
      payload.total && payload.completed != null
        ? Math.round((payload.completed / payload.total) * 100)
        : undefined;
    useModelStore.getState().updatePullStatus(modelKey, {
      status: payload.status,
      progress,
      completed: payload.completed ?? undefined,
      total: payload.total ?? undefined,
    });
    if (payload.status === 'success') {
      const data = await ollamaApi.getModels(useSettingsStore.getState().globalSettings.ollamaUrl);
      if (data) useModelStore.getState().setModels(data);
      const lang = useSettingsStore.getState().globalSettings.language;
      toast.success(translate('library.pullSuccess', lang));
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
  const lang = useSettingsStore.getState().globalSettings.language;
  toast.error(payload.error || translate('error.modelPullFailed', lang));
  setTimeout(
    () => isMountedRef() && useModelStore.getState().updatePullStatus(modelKey, null),
    8000
  );
};

/**
 * Listens for library-domain Tauri events (model pull lifecycle).
 *
 * This hook owns the reactive half of the model pull lifecycle — the
 * `pull-progress` and `pull-error` events emitted by Rust
 * (`src-tauri/src/ollama/model_service.rs`). The request half (initiating
 * pulls, aborting them) lives in `useModelPulling`.
 */
export function useLibraryTauriEvents() {
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
        await register(
          'pull-progress',
          PullProgressSchema,
          createPullProgressHandler(isMountedRef)
        );
        await register('pull-error', PullErrorSchema, createPullErrorHandler(isMountedRef));
      } catch (err) {
        logger.error('Library IPC initialization failure', { error: err });
      }
    };

    setup();

    return () => {
      isMounted = false;
      unlisteners.forEach((un) => un());
    };
  }, []);
}
