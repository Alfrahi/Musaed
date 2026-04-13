"use client";

import { useCallback } from 'react';
import { z } from 'zod';
import { OllamaModelSchema } from '@musaed/contracts';
import { useModelStore, useSettingsStore, useUIStore } from '../../../store';
import { invoke } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';
import toast from 'react-hot-toast';
import { useTranslation } from '../../../lib/i18n';

export function useModelActions() {
  const { setModels, setSelectedModel } = useModelStore();
  const { globalSettings } = useSettingsStore();
  const { setError, setOllamaConnected } = useUIStore();
  const { t } = useTranslation(globalSettings.language);

  const fetchModels = useCallback(async (isManual = false) => {
    const { ollamaUrl: baseUrl } = useSettingsStore.getState().globalSettings;
    if (isManual) toast.loading(t('library.refreshing'), { id: 'fetch-models' });
    
    try {
      const data = await invoke('get_ollama_models', { baseUrl }, z.array(OllamaModelSchema));
      
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
  }, [setModels, setSelectedModel, setError, setOllamaConnected, t]);

  const deleteModel = useCallback(async (name: string) => {
    const { ollamaUrl } = useSettingsStore.getState().globalSettings;
    const success = await invoke('delete_model', { baseUrl: ollamaUrl, name }, z.boolean());

    if (success) {
      await fetchModels();
    } else {
      logger.error('Failed to delete model', { name });
    }
  }, [fetchModels]);

  return { fetchModels, deleteModel };
}