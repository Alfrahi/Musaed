"use client";

import { useCallback } from 'react';
import { useConversationStore, useModelStore, useSettingsStore } from '../../../store';
import { invoke } from '../../../lib/ipc';
import { useTranslation } from '../../../lib/i18n';

export function useConversationActions() {
  const { 
    setConversations, 
    setCurrentConversationId, 
    stopStream
  } = useConversationStore();

  const createNewConversation = useCallback(() => {
    const state = useConversationStore.getState();
    const modelState = useModelStore.getState();
    const settingsState = useSettingsStore.getState();
    const { t } = useTranslation(settingsState.globalSettings.language);
    
    const id = crypto.randomUUID();
    const newConv = {
      id,
      title: t('sidebar.newChat'),
      messages: [],
      model: modelState.selectedModel,
      settings: settingsState.globalSettings,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    const currentList = state.conversationIds.map(id => state.conversations[id]);
    setConversations([newConv, ...currentList]);
    setCurrentConversationId(id);
  }, [setConversations, setCurrentConversationId]);

  const abortStreaming = useCallback((conversationId: string) => {
    const activeStreams = useConversationStore.getState().activeStreams;
    const requestId = activeStreams[conversationId];
    
    if (requestId) {
      invoke('abort_chat', { requestId });
    }
    
    stopStream(conversationId);
  }, [stopStream]);

  const deleteConversation = useCallback((id: string) => {
    const state = useConversationStore.getState();
    abortStreaming(id);
    
    const remaining = state.conversationIds
      .filter(cid => cid !== id)
      .map(cid => state.conversations[cid]);
      
    setConversations(remaining);
    if (state.currentConversationId === id) {
      setCurrentConversationId(null);
    }
  }, [abortStreaming, setConversations, setCurrentConversationId]);

  const updateConversationTitle = useCallback((id: string, title: string) => {
    const state = useConversationStore.getState();
    const currentList = state.conversationIds.map(cid => 
      cid === id ? { ...state.conversations[cid], title, updatedAt: Date.now() } : state.conversations[cid]
    );
    setConversations(currentList);
  }, [setConversations]);

  const clearAllConversations = useCallback(() => {
    const activeStreams = useConversationStore.getState().activeStreams;
    Object.keys(activeStreams).forEach(id => abortStreaming(id));
    setConversations([]);
    setCurrentConversationId(null);
  }, [abortStreaming, setConversations, setCurrentConversationId]);

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