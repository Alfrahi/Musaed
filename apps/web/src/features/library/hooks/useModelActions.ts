'use client';

import { useCallback } from 'react';
import { useModelStore, useSettingsStore } from '../../../store';
import {
  useSetModels,
  useSetSelectedModel,
  useSetUIError,
  useSetOllamaConnected,
  useGlobalSettings,
} from '../../../store/hooks';
import { ollamaApi } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';
import toast from 'react-hot-toast';
import { useTranslation } from '../../../lib/i18n';

/**
 * Hook providing actions for fetching and deleting Ollama models.
 */
export function useModelActions() {
  const setModels = useSetModels();
  const setSelectedModel = useSetSelectedModel();
  const globalSettings = useGlobalSettings();
  const setError = useSetUIError();
  const setOllamaConnected = useSetOllamaConnected();
  const { t } = useTranslation(globalSettings.language);

  /**
   * Fetches the list of available models from the configured Ollama server.
   */
  const fetchModels = useCallback(
    async (isManual = false) => {
      const { ollamaUrl: baseUrl } = useSettingsStore.getState().globalSettings;
      if (isManual) toast.loading(t('library.refreshing'), { id: 'fetch-models' });

      try {
        const data = await ollamaApi.getModels(baseUrl);

        if (data !== null) {
          setOllamaConnected(true);
          setModels(data);

          const { selectedModel: currentSelected } = useModelStore.getState();
          if (!currentSelected && data.length > 0) setSelectedModel(data[0].name);

          setError(null);
          if (isManual) toast.success(t('library.status.success'), { id: 'fetch-models' });
        } else {
          setOllamaConnected(false);
          setError('error.failedToFetchModels');
          if (isManual) toast.error(t('error.failedToFetchModels'), { id: 'fetch-models' });
        }
      } catch (err) {
        setOllamaConnected(false);
        logger.error('Exception during model fetch', { error: err });
        setError('error.failedToFetchModels');
        if (isManual) toast.error(t('error.failedToFetchModels'), { id: 'fetch-models' });
      }
    },
    [setModels, setSelectedModel, setError, setOllamaConnected, t]
  );

  /**
   * Deletes a specific model from the Ollama server.
   */
  const deleteModel = useCallback(
    async (name: string) => {
      const { ollamaUrl } = useSettingsStore.getState().globalSettings;
      const success = await ollamaApi.deleteModel(ollamaUrl, name);

      if (success) {
        await fetchModels();
      } else {
        logger.error('Failed to delete model', { name });
      }
    },
    [fetchModels]
  );

  return { fetchModels, deleteModel };
}
