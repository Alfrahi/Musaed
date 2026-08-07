'use client';

import { useCallback } from 'react';

import {
  useConversationStore,
  useUpdateConversation,
  useBatchUpdate,
} from '@/store/conversation-store';
import { useMessageStore } from '@/store/message-store';
import { useStreamingStore } from '@/store/streaming-store';
import { useModelStore } from '@/store/model-store';
import { useSettingsStore, useLanguage } from '@/store/settings-store';
import { conversationApi, chatApi } from '@/lib/ipc';
import { coordinateStartStream, stopStreamForConversation } from '@/store/coordination';
import { useTranslation } from '@/lib/i18n';
import type { ConversationMetadata, ConversationState } from '@/store/conversation-store';
import { logger } from '@/lib/logger';

/** Create a new conversation with current model and settings. */
const createConversation = async (
  batchUpdate: (updater: (state: ConversationState) => Partial<ConversationState>) => void,
  t: (key: string) => string
) => {
  const modelState = useModelStore.getState();
  const settingsState = useSettingsStore.getState();

  const id = crypto.randomUUID();
  const newConv: ConversationMetadata = {
    id,
    title: t('sidebar.newChat'),
    model: modelState.selectedModel,
    settings: settingsState.globalSettings,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Persist via Rust backend first — API requires full Conversation with messages
  const createdId = await conversationApi.createConversation({
    ...newConv,
    messages: [],
  });

  // Use the backend-returned ID (falls back to local id if null)
  const resolvedId = createdId ?? id;

  batchUpdate((state) => ({
    conversations: { [resolvedId]: newConv, ...state.conversations },
    conversationIds: [resolvedId, ...state.conversationIds],
    currentConversationId: resolvedId,
  }));
};

/**
 * Hook for conversation management (create, delete, rename, clear).
 */
export const useConversationActions = () => {
  const updateConversation = useUpdateConversation();
  const batchUpdate = useBatchUpdate();
  const language = useLanguage();
  const { t } = useTranslation(language);

  const createNewConversation = useCallback(() => {
    return createConversation(batchUpdate, t);
  }, [batchUpdate, t]);

  const deleteConversation = useCallback(
    (id: string) => {
      const requestId = useStreamingStore.getState().activeStreams[id];
      if (requestId) chatApi.abort(requestId);
      // Pass the requestId so stopStreamForConversation bails out if a new
      // stream has replaced the old one before this call runs (audit bug 2.3).
      stopStreamForConversation(id, requestId);
      const state = useConversationStore.getState();
      const { [id]: _removed, ...remainingConversations } = state.conversations;
      const remainingIds = state.conversationIds.filter((cid) => cid !== id);
      const newCurrentId = state.currentConversationId === id ? null : state.currentConversationId;

      batchUpdate(() => ({
        conversations: remainingConversations,
        conversationIds: remainingIds,
        currentConversationId: newCurrentId,
      }));

      // Persist deletion via Rust backend
      (async () => {
        try {
          await conversationApi.deleteConversation(id);
        } catch (e) {
          logger.error('Failed to delete conversation on backend:', { error: String(e) });
        }
      })();

      // Clean up messages
      useMessageStore.getState().clearMessages(id);
    },
    [batchUpdate]
  );

  const updateConversationTitle = useCallback(
    (id: string, title: string) => {
      const updatedAt = Date.now();
      updateConversation(id, { title, updatedAt });
      // Persist title update to Rust backend
      conversationApi
        .updateConversation(id, title, updatedAt)
        .catch((e) => logger.error('Failed to persist title update:', { error: String(e) }));
    },
    [updateConversation]
  );

  const clearAllConversations = useCallback(() => {
    const activeStreams = useStreamingStore.getState().activeStreams;
    Object.entries(activeStreams).forEach(([convId, requestId]) => {
      chatApi.abort(requestId);
      // Pass the requestId so stopStreamForConversation bails out if a new
      // stream has replaced the old one before this call runs (audit bug 2.3).
      stopStreamForConversation(convId, requestId);
    });

    // Persist clearing via Rust backend
    (async () => {
      try {
        await conversationApi.clearAllConversations();
      } catch (e) {
        logger.error('Failed to clear conversations on backend:', { error: String(e) });
      }
    })();

    batchUpdate(() => ({
      conversations: {},
      conversationIds: [],
      currentConversationId: null,
    }));

    // Clear all messages
    useMessageStore.getState().clearAllMessages();
  }, [batchUpdate]);

  const initiateStreaming = useCallback((conversationId: string, requestId: string) => {
    coordinateStartStream(conversationId, requestId);
  }, []);

  return {
    createNewConversation,
    deleteConversation,
    updateConversationTitle,
    clearAllConversations,
    initiateStreaming,
    stopStreamForConversation,
  };
};
