'use client';

import { useCallback } from 'react';
import { useUIStore } from '@/store/ui-store';
import { useSettingsStore } from '@/features/settings/store/settings-store';
import { useModelStore } from '@/features/settings/store/model-store';
import { useConversationStore } from '../store/conversation-store';
import { useSetInitialized, useSetUIError } from '@/store/hooks';
import { useModelActions } from '@/features/library';
import { useConversationActions } from './useConversationActions';
import { useSettingsActions } from '@/features/settings';
import { useStorageCleanup } from '@/features/settings';
import { initializeConversations } from '../utils/conversation-backend';
import { useMessageStore } from '../store/message-store';
import { conversationApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';
import { getSystemLanguage } from '@/lib/i18n';

export function useChatInitialization() {
  const setInitialized = useSetInitialized();
  const setError = useSetUIError();
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
          hasDetectedLanguage: true,
        });
      }

      // Execute storage retention policy cleanup
      runCleanup();

      try {
        // Fetch models and restore persisted model selection
        await fetchModels();

        const modelState = useModelStore.getState();
        // If a model was persisted and is still available, keep it selected
        // Otherwise, fall back to the first available model
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

      // Load persisted conversations from the Rust backend
      const conversations = await initializeConversations();
      if (conversations && conversations.length > 0) {
        const { batchUpdate } = useConversationStore.getState();
        batchUpdate(() => ({
          conversations: Object.fromEntries(conversations.map((c) => [c.id, c])),
          conversationIds: conversations.map((c) => c.id),
          currentConversationId: conversations[0].id,
        }));

        // Load messages for the most recent conversation
        try {
          const fullConv = await conversationApi.getConversation(conversations[0].id);
          if (fullConv && fullConv.messages.length > 0) {
            useMessageStore.getState().setMessages(conversations[0].id, fullConv.messages);
          }
        } catch (msgErr) {
          logger.warn('Failed to load messages for initial conversation', { error: msgErr });
        }
      } else {
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
  }, [
    updateGlobalSettings,
    fetchModels,
    createNewConversation,
    setInitialized,
    setError,
    runCleanup,
  ]);

  return { initializeApp };
}
