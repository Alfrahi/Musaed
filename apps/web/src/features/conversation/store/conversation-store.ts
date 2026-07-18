'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import { type Conversation } from '@musaed/contracts';
import { createTauriStorage } from '@/lib/tauri-storage';

// Default state for conversation store
const DEFAULT_CONVERSATION_STATE = {
  conversations: {},
  conversationIds: [],
  currentConversationId: null,
  searchQuery: '',
};

// Migrations for conversation store
const CONVERSATION_MIGRATIONS: Record<number, (data: unknown) => unknown> = {
  1: (data: unknown) => {
    const persisted =
      typeof data === 'object' && data !== null ? (data as Partial<ConversationState>) : {};
    return { ...DEFAULT_CONVERSATION_STATE, ...persisted };
  },
};

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
  return list.filter((conv) =>
    (conv.title ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  );
};

export const useConversationStore = createWithEqualityFn<ConversationState>()(
  persist(
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
    {
      name: 'musaed-conversation-storage',
      storage: createJSONStorage(() =>
        createTauriStorage('conversation-state.json', 1, CONVERSATION_MIGRATIONS)
      ),
      version: 1,
      migrate: (persistedState, version) => {
        const migration = CONVERSATION_MIGRATIONS[version];
        if (migration && typeof persistedState === 'object' && persistedState !== null) {
          return migration(persistedState);
        }
        return { ...DEFAULT_CONVERSATION_STATE, ...(persistedState as Partial<ConversationState>) };
      },
      skipHydration: true,
    }
  ),
  shallow
);

/** Hook for batch updating conversation state. */
export const useBatchUpdate = () => useConversationStore((state) => state.batchUpdate);

/** Hook for updating a single conversation. */
export const useUpdateConversation = () =>
  useConversationStore((state) => state.updateConversation);

// Selector hooks for external access (e.g., settings feature)
export const useConversations = () => useConversationStore((state) => state.conversations);
export const useConversationIds = () => useConversationStore((state) => state.conversationIds);
export const useSetConversations = () => useConversationStore((state) => state.setConversations);
export const useCurrentConversationId = () =>
  useConversationStore((state) => state.currentConversationId);
export const useSetCurrentConversationId = () =>
  useConversationStore((state) => state.setCurrentConversationId);
export const useSearchQuery = () => useConversationStore((state) => state.searchQuery);
export const useSetSearchQuery = () => useConversationStore((state) => state.setSearchQuery);

/** Hook for getting filtered conversations based on search query. */
export const useFilteredConversations = () => useConversationStore(selectFilteredConversations);
