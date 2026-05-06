'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Conversation } from '@musaed/contracts';
import { createTauriStorage, Migrations } from '../../lib/tauri-storage';
import { setHydrated } from '../actions';

const CONVERSATION_STORE_VERSION = 3;

interface StoredConversation {
  id: string;
  messages?: Array<{ done?: boolean; [key: string]: unknown }>;
  [key: string]: unknown;
}

/**
 * Strips messages from conversations for migration to version 3.
 * Messages are now handled by useMessageStore for better performance.
 */
const migrations: Migrations = {
  2: (data: unknown) => {
    const storageData = data as { conversations?: Record<string, StoredConversation> };
    if (storageData.conversations && typeof storageData.conversations === 'object') {
      const convs = storageData.conversations;
      Object.keys(convs).forEach((id) => {
        if (convs[id].messages) {
          convs[id].messages = convs[id].messages.map((m) => ({
            ...m,
            done: m.done ?? true,
          }));
        }
      });
    }
    return storageData;
  },
  3: (data: unknown) => {
    const storageData = data as { conversations?: Record<string, StoredConversation> };
    // Strip messages from stored conversations to reduce bloat
    if (storageData.conversations && typeof storageData.conversations === 'object') {
      const convs = storageData.conversations;
      Object.keys(convs).forEach((id) => {
        if (convs[id].messages) {
          delete convs[id].messages;
        }
      });
    }
    return storageData;
  },
};

/**
 * Wraps createTauriStorage for the conversation store.
 * Disk writes are direct as streaming state is now in useStreamingStore.
 */
const storage = createTauriStorage(
  'conversation-state-v2.json',
  CONVERSATION_STORE_VERSION,
  migrations
);

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
      name: 'musaed-conversation-storage-v2',
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({
        conversations: state.conversations,
        conversationIds: state.conversationIds,
        currentConversationId: state.currentConversationId,
      }),
      onRehydrateStorage: () => () => setHydrated(true),
    }
  ),
  shallow
);

/** Trigger a full state persist to disk. */
export function persistConversationsNow(): void {
  useConversationStore.setState({});
}
