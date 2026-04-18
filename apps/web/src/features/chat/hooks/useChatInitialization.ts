"use client";

import { useCallback } from 'react';
import { useUIStore, useConversationStore, useSettingsStore, useModelStore } from '@/store';
import { useModelActions } from '@/features/library';
import { useConversationActions } from './useConversationActions';
import { useSettingsActions, useStorageCleanup } from '@/features/settings';
import { logger } from '@/lib/logger';
import { getSystemLanguage } from '@/lib/i18n';

export function useChatInitialization() {
  const { setInitialized, setError } = useUIStore();
  const { updateGlobalSettings } = useSettingsActions();
  const { fetchModels } = useModelActions();
  const { createNewConversation } = useConversationActions();
  const { runCleanup } = useStorageCleanup();

  const initializeApp = useCallback(async () => {
    if (useUIStore.getState().isInitialized) return;

    try {
      const currentSettings = useSettingsStore.getState().globalSettings;
      if (!currentSettings.hasDetectedLanguage) {
        const sysLang = getSystemLanguage();
        updateGlobalSettings({
          language: sysLang,
          hasDetectedLanguage: true
        });
      }

      // Execute storage retention policy cleanup
      runCleanup();

      try {
        // Fetch models and handle smart selection
        await fetchModels();
        
        const modelState = useModelStore.getState();
        if (!modelState.selectedModel && modelState.models.length > 0) {
          modelState.setSelectedModel(modelState.models[0].name);
        }
      } catch (fetchErr) {
        logger.warn('Initial model fetch failed', { error: fetchErr });
      }

      const { conversationIds } = useConversationStore.getState();
      if (conversationIds.length === 0) {
        createNewConversation();
      }

      setInitialized(true);
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('Initialization failed', { error: errorMessage });
      setInitialized(true);
      setError('error.initializationFailed');
    }
  }, [updateGlobalSettings, fetchModels, createNewConversation, setInitialized, setError, runCleanup]);

  return { initializeApp };
}