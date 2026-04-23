"use client";

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Conversation, Message } from '@musaed/contracts';
import { createTauriStorage } from '../../lib/tauri-storage';
import { setStreaming, setHydrated } from '../actions';

interface ConversationState {
  conversations: Record<string, Conversation>;
  conversationIds: string[];
  currentConversationId: string | null;
  activeStreams: Record<string, string>;
  searchQuery: string;
  setConversations: (conversations: Conversation[]) => void;
  setCurrentConversationId: (id: string | null) => void;
  setSearchQuery: (searchQuery: string) => void;
  addMessage: (conversationId: string, message: Message) => void;
  updateLastMessage: (conversationId: string, update: Partial<Message>, replace?: boolean) => void;
  startStream: (conversationId: string, requestId: string) => void;
  stopStream: (conversationId: string) => void;
}

export const useConversationStore = createWithEqualityFn<ConversationState>()(
  persist(
    (set) => ({
      conversations: {},
      conversationIds: [],
      currentConversationId: null,
      activeStreams: {},
      searchQuery: '',

      setConversations: (convs) => set({
        conversations: Object.fromEntries(convs.map(c => [c.id, c])),
        conversationIds: convs.map(c => c.id)
      }),

      setCurrentConversationId: (id) => set({ currentConversationId: id }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      
      startStream: (conversationId, requestId) => set((state) => {
        setStreaming(true);
        return { activeStreams: { ...state.activeStreams, [conversationId]: String(requestId) } };
      }),

      stopStream: (conversationId) => set((state) => {
        const { [conversationId]: _, ...remainingStreams } = state.activeStreams;
        setStreaming(Object.keys(remainingStreams).length > 0);
        return { activeStreams: remainingStreams };
      }),

      addMessage: (conversationId, message) => set((state) => {
        const conv = state.conversations[conversationId];
        if (!conv) return state;

        return {
          conversations: {
            ...state.conversations,
            [conversationId]: {
              ...conv,
              messages: [...conv.messages, message],
              updatedAt: Date.now()
            }
          }
        };
      }),

      updateLastMessage: (conversationId, update, replace = false) => set((state) => {
        const conv = state.conversations[conversationId];
        if (!conv || conv.messages.length === 0) return state;

        const messages = [...conv.messages];
        const lastIdx = messages.length - 1;
        const currentMsg = messages[lastIdx];

        messages[lastIdx] = { 
          ...currentMsg, 
          ...update, 
          content: replace 
            ? (update.content ?? currentMsg.content) 
            : (currentMsg.content + (update.content ?? ''))
        };

        return {
          conversations: {
            ...state.conversations,
            [conversationId]: { ...conv, messages, updatedAt: Date.now() }
          }
        };
      }),
    }),
    {
      name: 'musaed-conversation-storage-v2',
      storage: createJSONStorage(() => createTauriStorage('conversation-state-v2.json')),
      partialize: (state) => ({ 
        conversations: state.conversations, 
        conversationIds: state.conversationIds,
        currentConversationId: state.currentConversationId 
      }),
      onRehydrateStorage: () => () => setHydrated(true),
    }
  ),
  shallow
);