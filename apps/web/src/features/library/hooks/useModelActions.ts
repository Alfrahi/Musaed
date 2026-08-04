'use client';

import { useCallback, useState } from 'react';
import { useModelStore } from '@/store/model-store';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';
import { ollamaApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';
import toast from 'react-hot-toast';
import { useTranslation } from '@/lib/i18n';

/**
 * Hook providing actions for fetching and deleting Ollama models.
 *
 * `isFetching` is ephemeral UI state local to the hook instance — it is NOT
 * persisted in the model store. ModelSelector reads it to distinguish the
 * "fetch in progress" loading state from the "fetch completed, zero models"
 * empty state (audit finding UX-012 / S-7).
 */
export function useModelActions() {
  const setModels = useModelStore((s) => s.setModels);
  const setSelectedModel = useModelStore((s) => s.setSelectedModel);
  const setFetchError = useModelStore((s) => s.setFetchError);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const setErrorMessage = useUIStore((s) => s.setErrorMessage);
  const setOllamaConnected = useUIStore((s) => s.setOllamaConnected);
  const { t } = useTranslation(language);
  const [isFetching, setIsFetching] = useState(false);

  /**
   * Fetches the list of available models from the configured Ollama server.
   */
  const fetchModels = useCallback(
    async (isManual = false) => {
      const { ollamaUrl: baseUrl } = useSettingsStore.getState().globalSettings;
      if (isManual) toast.loading(t('library.refreshing'), { id: 'fetch-models' });
      setIsFetching(true);

      try {
        const data = await ollamaApi.getModels(baseUrl);

        if (data !== null) {
          setOllamaConnected(true);
          setModels(data);
          setFetchError(null);

          const { selectedModel: currentSelected } = useModelStore.getState();
          if (!currentSelected && data.length > 0) setSelectedModel(data[0].name);

          setErrorMessage(null);
          if (isManual) toast.success(t('library.status.success'), { id: 'fetch-models' });
        } else {
          setOllamaConnected(false);
          const errorMsg = t('error.failedToFetchModels');
          setFetchError(errorMsg);
          setErrorMessage(errorMsg);
          if (isManual) toast.error(errorMsg, { id: 'fetch-models' });
        }
      } catch (err) {
        setOllamaConnected(false);
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error('Exception during model fetch', { error: errorMsg });
        setFetchError(t('error.failedToFetchModels'));
        setErrorMessage(t('error.failedToFetchModels'));
        if (isManual) toast.error(t('error.failedToFetchModels'), { id: 'fetch-models' });
      } finally {
        setIsFetching(false);
      }
    },
    [setModels, setSelectedModel, setFetchError, setErrorMessage, setOllamaConnected, t]
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

  return { fetchModels, deleteModel, isFetching };
}
