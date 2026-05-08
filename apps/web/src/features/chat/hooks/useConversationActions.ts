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
import { coordinateStartStream, coordinateStopStream } from '../../../store/coordination';
import { chatApi } from '../../../lib/ipc';
import { useTranslation } from '../../../lib/i18n';
import { stopBatching } from '../../../store/batch-manager';
import type { ConversationMetadata } from '../../../store/stores/conversation-store';

/**
 * Abort active streaming for a conversation.
 */
export function abortStreaming(conversationId: string): void {
  const streamingState = useStreamingStore.getState();
  const requestId = streamingState.activeStreams[conversationId];

  if (requestId) chatApi.abort(requestId);
  stopBatching(conversationId);
  coordinateStopStream(conversationId);
}

/** Create a new conversation with current model and settings. */
const createConversation = (
  batchUpdate: (
    updater: (
      state: import('../../../store/stores/conversation-store').ConversationState
    ) => Partial<import('../../../store/stores/conversation-store').ConversationState>
  ) => void,
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

  batchUpdate((state) => ({
    conversations: { [id]: newConv, ...state.conversations },
    conversationIds: [id, ...state.conversationIds],
    currentConversationId: id,
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
