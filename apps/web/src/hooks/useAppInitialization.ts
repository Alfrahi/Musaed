'use client';

/**
 * App boot orchestrator.
 *
 * Lives in `src/hooks/` (not `features/conversation/`) because it coordinates
 * multiple features at startup: language detection (settings), storage cleanup
 * (settings), model fetch + restore (library), and conversation hydration
 * (conversation). Per STANDARDS.md §3, no feature may import a sibling
 * feature; an orchestrator that crosses those boundaries by design belongs
 * in the shared `src/hooks/` layer, not inside any one feature. See the
 * architecture decision recorded in
 * `apps/web/src/store/coordination.ts` and AUDIT.txt §3.1.
 *
 * `HomeClient.tsx` (the layout composition root) is the only consumer; it
 * invokes `initializeApp()` once on mount.
 */
import { useCallback } from 'react';
import { useUIStore } from '@/store/ui-store';
import { useSettingsStore } from '@/store/settings-store';
import { useModelStore } from '@/store/model-store';
import { useConversationStore } from '@/store/conversation-store';
import { useSetInitialized, useSetUIError } from '@/store/hooks';
import { useModelActions } from '@/features/library';
import { useConversationActions, initializeConversations } from '@/features/conversation';
import { useSettingsActions, useStorageCleanup } from '@/features/settings';
import { useMessageStore } from '@/store/message-store';
import { conversationApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';
import { getSystemLanguage, setActiveLanguageResolver } from '@/lib/i18n';

export function useAppInitialization() {
  const setInitialized = useSetInitialized();
  const setError = useSetUIError();
  const { updateGlobalSettings } = useSettingsActions();
  const { fetchModels } = useModelActions();
  const { createNewConversation } = useConversationActions();
  const { runCleanup } = useStorageCleanup();

  const initializeApp = useCallback(async () => {
    if (useUIStore.getState().isInitialized) return;

    // Wire the i18n language resolver for module-scoped code (lib/ipc.ts toast
    // error paths, etc.). The resolver reads live settings state on each call so
    // it tracks language changes without needing re-registration. Done here,
    // rather than via a top-level `lib/ipc → store` import, to avoid a static
    // import cycle banned by dep-cruiser (see `setActiveLanguageResolver` docs).
    setActiveLanguageResolver(() => useSettingsStore.getState().globalSettings.language);

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
