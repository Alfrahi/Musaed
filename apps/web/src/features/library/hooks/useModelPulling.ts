'use client';

import { useCallback } from 'react';
import { useModelStore } from '@/features/settings/store/model-store';
import { useSettingsStore } from '@/features/settings/store/settings-store';
import { useTranslation } from '@/lib/i18n';
import { ollamaApi, checkIsTauri } from '@/lib/ipc';
import { logger } from '@/lib/logger';
import toast from 'react-hot-toast';

/**
 * Hook for initiating and tracking model pull requests from Ollama.
 */
export function useModelPulling() {
  const pullStatus = useModelStore((s) => s.pullStatus);
  const updatePullStatus = useModelStore((s) => s.updatePullStatus);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);

  /**
   * Translates internal Ollama status codes to user-friendly text.
   */
  const translateOllamaStatus = useCallback(
    (status: string) => {
      const key = status.toLowerCase();
      if (key.includes('pulling manifest')) return t('library.status.pullingManifest');
      if (key.includes('downloading')) return t('library.status.downloading');
      if (key.includes('verifying')) return t('library.status.verifying');
      if (key.includes('writing manifest')) return t('library.status.writingManifest');
      if (key.includes('success')) return t('library.status.success');
      if (key === 'starting') return t('library.status.starting');
      return status;
    },
    [t]
  );

  /**
   * Triggers a model pull request.
   */
  const handlePull = async (name: string) => {
    if (!name.trim()) return;

    updatePullStatus(name, { status: 'starting' });

    if (!checkIsTauri()) {
      setTimeout(() => {
        updatePullStatus(name, { status: 'success' });
        toast.success(t('chat.webPreviewWarning'));
        setTimeout(() => updatePullStatus(name, null), 3000);
      }, 1000);
      return;
    }

    try {
      const { ollamaUrl } = useSettingsStore.getState().globalSettings;
      await ollamaApi.pullModel(ollamaUrl, name);
    } catch (err) {
      logger.error('Model pull trigger failed', { error: err });
      updatePullStatus(name, null);
      toast.error(t('error.genericError'));
    }
  };

  return { pullStatus, handlePull, translateOllamaStatus };
}
