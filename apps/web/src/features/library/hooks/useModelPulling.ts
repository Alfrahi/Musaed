"use client";

import { useCallback } from 'react';
import { useModelStore, useSettingsStore } from '../../../store';
import { useTranslation } from '../../../lib/i18n';
import { invoke, checkIsTauri } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';
import toast from 'react-hot-toast';

export function useModelPulling() {
  const { pullStatus, updatePullStatus } = useModelStore();
  const { globalSettings } = useSettingsStore();
  const { t } = useTranslation(globalSettings.language);
  
  // This helper is now only for UI display, we store the raw keys in Zustand
  const translateOllamaStatus = useCallback((status: string) => {
    const key = status.toLowerCase();
    if (key.includes('pulling manifest')) return t('library.status.pullingManifest');
    if (key.includes('downloading')) return t('library.status.downloading');
    if (key.includes('verifying')) return t('library.status.verifying');
    if (key.includes('writing manifest')) return t('library.status.writingManifest');
    if (key.includes('success')) return t('library.status.success');
    if (key === 'starting') return t('library.status.starting');
    return status;
  }, [t]);

  const handlePull = async (name: string) => {
    if (!name.trim()) return;
    
    // Violation fix: Store the raw key 'starting' instead of translated text
    updatePullStatus(name, { status: 'starting' });

    if (!checkIsTauri()) {
      setTimeout(() => {
        updatePullStatus(name, { status: 'success' });
        toast.success(t('chat.webPreviewWarning'));
        setTimeout(() => updatePullStatus(name, null), 3000);
      }, 1000);
      return;
    }

    const result = await invoke('pull_model', { baseUrl: globalSettings.ollamaUrl, name });
    if (result === null) updatePullStatus(name, null);
  };

  return { pullStatus, handlePull, translateOllamaStatus };
}