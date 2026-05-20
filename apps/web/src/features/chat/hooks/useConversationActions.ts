'use client';

import { useCallback } from 'react';

import {
  useConversationStore,
  useModelStore,
  useSettingsStore,
  useStreamingStore,
  useMessageStore,
} from '../../../store';
import { useSetConversations, useBatchUpdate } from '../../../store/hooks';
import { chatApi, conversationApi } from '../../../lib/ipc';
import { coordinateStartStream, coordinateStopStream } from '../../../store/coordination';
import { useTranslation } from '../../../lib/i18n';
import type {
  ConversationMetadata,
  ConversationState,
} from '../../../store/stores/conversation-store';

/**
 * Abort active streaming for a conversation.
 */
export function abortStreaming(conversationId: string): void {
  const streamingState = useStreamingStore.getState();
  const requestId = streamingState.activeStreams[conversationId];
  if (requestId) chatApi.abort(requestId);
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
  const setConversations = useSetConversations();
  const batchUpdate = useBatchUpdate();
  const { t } = useTranslation(useSettingsStore.getState().globalSettings.language);

  const createNewConversation = useCallback(() => {
    createConversation(batchUpdate, t);
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
      const state = useConversationStore.getState();
      const updated = state.conversationIds.map((cid) =>
        cid === id
          ? { ...state.conversations[cid], title, updatedAt: Date.now() }
          : state.conversations[cid]
      );
      setConversations(updated);
    },
    [setConversations]
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
