'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
// import { persist, createJSONStorage } from 'zustand/middleware'; // persistence moved to Rust
import { type Conversation } from '@musaed/contracts';
// import { createTauriStorage } from '@/lib/tauri-storage'; // persistence moved to Rust
// import { useUIStore } from '@/store/ui-store'; // no longer needed
import { traceStoreMutation } from '@/lib/store-tracing';
// import { logger } from '@/lib/logger'; // no longer needed

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
  2: (data: unknown) => {
    const persisted =
      typeof data === 'object' && data !== null ? (data as Partial<ConversationState>) : {};
    // Schema change: `Message.error` is now optional in the contract (TS
    // `Message.error?: { code; message }`). This store never persists messages
    // directly — it persists `ConversationMetadata` only — so the migration
    // is intentionally a pass-through. Rust round-trips messages through its
    // own SQLite migration.
    return { ...DEFAULT_CONVERSATION_STATE, ...persisted };
  },
  3: (data: unknown) => {
    const persisted =
      typeof data === 'object' && data !== null ? (data as Partial<ConversationState>) : {};
    // Schema change: `Message.stopped` is now optional in the contract (TS
    // `Message.stopped?: boolean`). This store never persists messages
    // directly — it persists `ConversationMetadata` only — so the migration
    // is intentionally a pass-through. Rust round-trips messages through
    // its own SQLite migration.
    return { ...DEFAULT_CONVERSATION_STATE, ...persisted };
  },
};

// Exported so unit tests can round-trip legacy shapes without spinning up the
// whole Zustand store. Internal — not part of the public store API surface.
export const CONVERSATION_STORE_VERSION = 3;
export const __test_CONVERSATION_MIGRATIONS = CONVERSATION_MIGRATIONS;
// Back-compat alias for tests that import the old `__test_`-prefixed name.
// `CONVERSATION_STORE_VERSION` is the canonical identifier consumed by
// scripts/validate-manifests.mjs (`extractStoreVersion`).
export const __test_CONVERSATION_STORE_VERSION = CONVERSATION_STORE_VERSION;

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
      set((state) => {
        traceStoreMutation({
          feature: 'conversation',
          action: 'addConversation',
          level: 'INFO',
          message: `addConversation ${conv.id}`,
          context: { conversationId: conv.id, title: conv.title ?? null },
          throttleMs: 0,
        });
        return {
          conversations: { ...state.conversations, [conv.id]: conv },
          conversationIds: [conv.id, ...state.conversationIds],
        };
      }),
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
        traceStoreMutation({
          feature: 'conversation',
          action: 'removeConversation',
          level: 'INFO',
          message: `removeConversation ${id}`,
          context: {
            conversationId: id,
            wasCurrent: state.currentConversationId === id,
          },
          throttleMs: 0,
        });
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
