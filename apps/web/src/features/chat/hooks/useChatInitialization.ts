"use client";

import { useCallback } from 'react';
import { useUIStore, useConversationStore, useSettingsStore } from '@/store';
import { useModelActions } from '@/features/library';
import { useConversationActions } from './useConversationActions';
import { useSettingsActions } from '@/features/settings';
import { logger } from '@/lib/logger';
import { getSystemLanguage } from '@/lib/i18n';

export function useChatInitialization() {
  const { setInitialized, setError } = useUIStore();
  const { updateGlobalSettings } = useSettingsActions();
  const { fetchModels } = useModelActions();
  const { createNewConversation } = useConversationActions();

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

      try {
        const fetchPromise = fetchModels();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Model fetch timed out')), 5000)
        );
        
        await Promise.race([fetchPromise, timeoutPromise]);
      } catch (fetchErr) {
        logger.warn('Initial model fetch failed or timed out', { error: fetchErr });
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
  }, [updateGlobalSettings, fetchModels, createNewConversation, setInitialized, setError]);

  return { initializeApp };
}