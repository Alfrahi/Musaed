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
import { chatApi, conversationApi } from '@/lib/ipc';
import { coordinateStartStream, coordinateStopStream, flushAndStop } from '@/store/coordination';
import { useTranslation } from '@/lib/i18n';
import { updateConversation as backendUpdateConversation } from '@/features/conversation/utils/conversation-backend';
import type { ConversationMetadata, ConversationState } from '@/store/conversation-store';

/**
 * Abort active streaming for a conversation.
 * Flushes any buffered tokens to the message store before aborting
 * so no content is silently discarded.
 */
export function abortStreaming(conversationId: string): void {
  const streamingState = useStreamingStore.getState();
  const requestId = streamingState.activeStreams[conversationId];
  if (requestId) chatApi.abort(requestId);
  flushAndStop(conversationId);
  coordinateStopStream(conversationId);
}

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
      abortStreaming(id);
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
          console.error('Failed to delete conversation on backend:', e);
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
      backendUpdateConversation(id, title, updatedAt).catch((e) =>
        console.error('Failed to persist title update:', e)
      );
    },
    [updateConversation]
  );

  const clearAllConversations = useCallback(() => {
    Object.keys(useStreamingStore.getState().activeStreams).forEach(abortStreaming);

    // Persist clearing via Rust backend
    (async () => {
      try {
        await conversationApi.clearAllConversations();
      } catch (e) {
        console.error('Failed to clear conversations on backend:', e);
      }
    })();

    batchUpdate(() => ({
      conversations: {},
      conversationIds: [],
      currentConversationId: null,
    }));

    // Clear all messages
    useMessageStore.setState({ messages: {} });
  }, [batchUpdate]);

  const initiateStreaming = useCallback((conversationId: string, requestId: string) => {
    coordinateStartStream(conversationId, requestId);
  }, []);

  const stopStreaming = useCallback((conversationId: string) => {
    flushAndStop(conversationId);
    coordinateStopStream(conversationId);
  }, []);

  return {
    createNewConversation,
    deleteConversation,
    updateConversationTitle,
    clearAllConversations,
    initiateStreaming,
    stopStreaming,
  };
};
