'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';

// Persistence handled by Rust backend — in-memory cache only

import { type Message } from '@musaed/contracts';

interface MessageState {
  /** conversationId -> messages */
  messages: Record<string, Message[]>;
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (conversationId: string, message: Message) => void;
  addMessages: (conversationId: string, messages: Message[]) => void;
  updateLastMessage: (conversationId: string, update: Partial<Message>, replace?: boolean) => void;
  clearMessages: (conversationId: string) => void;
}

export const useMessageStore = createWithEqualityFn<MessageState>()(
  // Simple in-memory cache for messages. Persistence is handled by the Rust backend.
  // The store holds messages per conversation and provides mutators used by UI hooks.
  // No persistence middleware; the cache is refreshed from the backend when a conversation is opened.
  (set) => ({
    messages: {},

    setMessages: (conversationId, messages) =>
      set((state) => ({
        messages: { ...state.messages, [conversationId]: messages },
      })),

    addMessage: (conversationId, message) =>
      set((state) => ({
        messages: {
          ...state.messages,
          [conversationId]: [...(state.messages[conversationId] ?? []), message],
        },
      })),

    addMessages: (conversationId, messages) =>
      set((state) => ({
        messages: {
          ...state.messages,
          [conversationId]: [...(state.messages[conversationId] ?? []), ...messages],
        },
      })),

    updateLastMessage: (conversationId, update, replace = false) =>
      set((state) => {
        const msgs = state.messages[conversationId];
        if (!msgs || msgs.length === 0) return state;
        const newMsgs = [...msgs];
        const lastIdx = newMsgs.length - 1;
        newMsgs[lastIdx] = {
          ...newMsgs[lastIdx],
          ...update,
          content: replace
            ? (update.content ?? newMsgs[lastIdx].content)
            : newMsgs[lastIdx].content + (update.content ?? ''),
        };
        return {
          messages: { ...state.messages, [conversationId]: newMsgs },
        };
      }),

    clearMessages: (conversationId) =>
      set((state) => {
        const { [conversationId]: _, ...rest } = state.messages;
        return { messages: rest };
      }),
  }),
  shallow
);

export const selectMessages = (conversationId: string) => (state: MessageState) =>
  state.messages[conversationId] ?? [];
