"use client";

import { useCallback } from 'react';
import { useConversationStore, useModelStore, useSettingsStore } from '../../../store';
import { useSetConversations, useSetCurrentConversationId, useBatchUpdate } from '../../../store/hooks';
import { chatApi } from '../../../lib/ipc';
import { useTranslation } from '../../../lib/i18n';
import type { Conversation } from '@musaed/contracts';

/**
 * Abort active streaming for a conversation.
 */
export function abortStreaming(conversationId: string): void {
  const state = useConversationStore.getState();
  const requestId = state.activeStreams[conversationId];

  if (requestId) {
    chatApi.abort(requestId);
  }
  state.stopStream(conversationId);
}

/**
 * Hook for conversation management (create, delete, rename, clear).
 */
export const useConversationActions = () => {
  const setConversations = useSetConversations();
  const setCurrentConversationId = useSetCurrentConversationId();
  const batchUpdate = useBatchUpdate();

  const { t } = useTranslation(useSettingsStore.getState().globalSettings.language);

  const createNewConversation = useCallback(() => {
    const modelState = useModelStore.getState();
    const settingsState = useSettingsStore.getState();

    const id = crypto.randomUUID();
    const newConv: Conversation = {
      id,
      title: t('sidebar.newChat'),
      messages: [],
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
  }, [batchUpdate, t]);

  const deleteConversation = useCallback((id: string) => {
    abortStreaming(id);

    const state = useConversationStore.getState();
    const { [id]: _, ...remainingConversations } = state.conversations;
    const remainingIds = state.conversationIds.filter(cid => cid !== id);
    const newCurrentId = state.currentConversationId === id ? null : state.currentConversationId;

    batchUpdate(() => ({
      conversations: remainingConversations,
      conversationIds: remainingIds,
      currentConversationId: newCurrentId,
    }));
  }, [batchUpdate]);

  const updateConversationTitle = useCallback((id: string, title: string) => {
    const state = useConversationStore.getState();
    const updated = state.conversationIds.map(cid =>
      cid === id
        ? { ...state.conversations[cid], title, updatedAt: Date.now() }
        : state.conversations[cid]
    );
    setConversations(updated);
  }, [setConversations]);

  const clearAllConversations = useCallback(() => {
    const state = useConversationStore.getState();
    Object.keys(state.activeStreams).forEach(abortStreaming);

    batchUpdate(() => ({
      conversations: {},
      conversationIds: [],
      currentConversationId: null,
    }));
  }, [batchUpdate]);

  // Expose streaming control functions
  const initiateStreaming = useCallback((conversationId: string, requestId: string) => {
    useConversationStore.getState().startStream(conversationId, requestId);
  }, []);

  const stopStreaming = useCallback((conversationId: string) => {
    useConversationStore.getState().stopStream(conversationId);
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
