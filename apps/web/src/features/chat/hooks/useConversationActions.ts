"use client";

import { useCallback } from 'react';
import { useConversationStore, useModelStore, useSettingsStore } from '../../../store';
import { useSetConversations, useSetCurrentConversationId, useStopStream, useBatchUpdate } from '../../../store/hooks';
import { chatApi } from '../../../lib/ipc';
import { useTranslation } from '../../../lib/i18n';
import type { Conversation } from '@musaed/contracts';

/**
 * Hook for managing conversation lifecycle actions like creation, deletion, and streaming control.
 */
export function useConversationActions() {
  const setConversations = useSetConversations();
  const setCurrentConversationId = useSetCurrentConversationId();
  const stopStream = useStopStream();
  const batchUpdate = useBatchUpdate();

  /**
   * Initializes a new conversation with default settings.
   */
  const createNewConversation = useCallback(() => {
    const state = useConversationStore.getState();
    const modelState = useModelStore.getState();
    const settingsState = useSettingsStore.getState();
    const { t } = useTranslation(settingsState.globalSettings.language);

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
  }, [batchUpdate]);

  /**
   * Aborts an active streaming request for a conversation.
   */
  const abortStreaming = useCallback((conversationId: string) => {
    const activeStreams = useConversationStore.getState().activeStreams;
    const requestId = activeStreams[conversationId];
    
    if (requestId) {
      chatApi.abort(requestId);
    }
    
    stopStream(conversationId);
  }, [stopStream]);

  /**
   * Removes a conversation and stops any active streams.
   */
  const deleteConversation = useCallback((id: string) => {
    const state = useConversationStore.getState();
    abortStreaming(id);

    const { [id]: _, ...remainingConversations } = state.conversations;
    const remainingIds = state.conversationIds.filter(cid => cid !== id);
    const newCurrentId = state.currentConversationId === id ? null : state.currentConversationId;

    batchUpdate(() => ({
      conversations: remainingConversations,
      conversationIds: remainingIds,
      currentConversationId: newCurrentId,
    }));
  }, [abortStreaming, batchUpdate]);

  /**
   * Updates the display title of a conversation.
   */
  const updateConversationTitle = useCallback((id: string, title: string) => {
    const state = useConversationStore.getState();
    const currentList = state.conversationIds.map(cid => 
      cid === id ? { ...state.conversations[cid], title, updatedAt: Date.now() } : state.conversations[cid]
    );
    setConversations(currentList);
  }, [setConversations]);

  /**
   * Clears the entire chat history.
   */
  const clearAllConversations = useCallback(() => {
    const activeStreams = useConversationStore.getState().activeStreams;
    Object.keys(activeStreams).forEach(id => abortStreaming(id));

    batchUpdate(() => ({
      conversations: {},
      conversationIds: [],
      currentConversationId: null,
    }));
  }, [abortStreaming, batchUpdate]);

  /**
   * Internal helper to start streaming state.
   */
  const initiateStreaming = useCallback((conversationId: string, requestId: string) => {
    const startStream = useConversationStore.getState().startStream;
    startStream(conversationId, requestId);
  }, []);

  return {
    createNewConversation,
    deleteConversation,
    updateConversationTitle,
    clearAllConversations,
    initiateStreaming,
    stopStreaming: stopStream,
    abortStreaming
  };
}