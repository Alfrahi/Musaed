'use client';

import { useCallback } from 'react';
import { useModelStore } from '@/store/model-store';
import { useModelActions } from './useModelActions';
import { logger } from '@/lib/logger';

/**
 * Boot-phase initialization for the library feature.
 *
 * Fetches available models from the Ollama server and restores the persisted
 * model selection (or falls back to the first available model).
 *
 * Extracted from the monolithic `useAppInitialization` orchestrator so each
 * feature owns its own init sequence. Called once at app startup.
 */
export function useLibraryInitialization() {
  const { fetchModels } = useModelActions();

  const initialize = useCallback(async () => {
    try {
      await fetchModels();

      const modelState = useModelStore.getState();
      // If a model was persisted and is still available, keep it selected.
      // Otherwise, fall back to the first available model.
      if (!modelState.selectedModel && modelState.models.length > 0) {
        modelState.setSelectedModel(modelState.models[0].name);
      } else if (
        modelState.selectedModel &&
        !modelState.models.some((m) => m.name === modelState.selectedModel)
      ) {
        // Persisted model no longer exists, reset to first available
        modelState.setSelectedModel(modelState.models[0].name);
      }
    } catch (fetchErr) {
      logger.warn('Initial model fetch failed', { error: fetchErr });
    }
  }, [fetchModels]);

  return { initialize };
}
