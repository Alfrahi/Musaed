'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { type Conversation } from '@musaed/contracts';

// Persistence handled by Rust backend — no Tauri Store middleware needed

export type ConversationMetadata = Omit<Conversation, 'messages'>;

export interface ConversationState {
  conversations: Record<string, ConversationMetadata>;
  conversationIds: string[];
  currentConversationId: string | null;
  searchQuery: string;

  // Actions
  setConversations: (conversations: ConversationMetadata[]) => void;
  setCurrentConversationId: (id: string | null) => void;
  setSearchQuery: (searchQuery: string) => void;
  addConversation: (conversation: ConversationMetadata) => void;
  updateConversation: (id: string, updates: Partial<ConversationMetadata>) => void;
  removeConversation: (id: string) => void;
  batchUpdate: (updater: (state: ConversationState) => Partial<ConversationState>) => void;
}

// Selectors
export const selectCurrentConversation = (state: ConversationState) =>
  state.currentConversationId ? state.conversations[state.currentConversationId] : null;

export const selectFilteredConversations = (state: ConversationState) => {
  const { conversations, conversationIds, searchQuery } = state;
  const list = conversationIds.map((id) => conversations[id]).filter(Boolean);
  if (!searchQuery) return list;
  return list.filter((conv) => conv.title.toLowerCase().includes(searchQuery.toLowerCase()));
};

export const useConversationStore = createWithEqualityFn<ConversationState>()(
  (set) => ({
    conversations: {},
    conversationIds: [],
    currentConversationId: null,
    searchQuery: '',

    setConversations: (convs) =>
      set({
        conversations: Object.fromEntries(convs.map((c) => [c.id, c])),
        conversationIds: convs.map((c) => c.id),
      }),
    setCurrentConversationId: (id) => set({ currentConversationId: id }),
    setSearchQuery: (query) => set({ searchQuery: query }),
    addConversation: (conv) =>
      set((state) => ({
        conversations: { ...state.conversations, [conv.id]: conv },
        conversationIds: [conv.id, ...state.conversationIds],
      })),
    updateConversation: (id, updates) =>
      set((state) => {
        const conv = state.conversations[id];
        if (!conv) return state;
        return {
          conversations: {
            ...state.conversations,
            [id]: { ...conv, ...updates, updatedAt: Date.now() },
          },
        };
      }),
    removeConversation: (id) =>
      set((state) => {
        const { [id]: _, ...remaining } = state.conversations;
        return {
          conversations: remaining,
          conversationIds: state.conversationIds.filter((cid) => cid !== id),
          currentConversationId:
            state.currentConversationId === id ? null : state.currentConversationId,
        };
      }),
    batchUpdate: (updater) => set(updater),
  }),
  shallow
);
