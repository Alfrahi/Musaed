'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';

// Persistence handled by Rust backend — in-memory cache only

import { type Message } from '@musaed/contracts';
import { traceStoreMutation } from '@/lib/store-tracing';

export interface MessageState {
  /** conversationId -> messages */
  messages: Record<string, Message[]>;
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (conversationId: string, message: Message) => void;
  addMessages: (conversationId: string, messages: Message[]) => void;
  updateLastMessage: (conversationId: string, update: Partial<Message>, replace?: boolean) => void;
  updateMessage: (conversationId: string, messageId: string, patch: Partial<Message>) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  clearMessages: (conversationId: string) => void;
  clearAllMessages: () => void;
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
        const isDone = update.done === true;
        newMsgs[lastIdx] = {
          ...newMsgs[lastIdx],
          ...update,
          content: replace
            ? (update.content ?? newMsgs[lastIdx].content)
            : newMsgs[lastIdx].content + (update.content ?? ''),
        };
        // Throttle streaming flush increments per-conversation so multi-stream
        // tracing stays independent. Final (done:true) flush always emits.
        traceStoreMutation({
          feature: 'message',
          action: 'updateLastMessage',
          level: 'DEBUG',
          message: `updateLastMessage for ${conversationId}`,
          context: {
            conversationId,
            replace,
            isDone,
            contentLen: newMsgs[lastIdx].content.length,
          },
          throttleMs: isDone ? 0 : undefined,
          throttleKeySuffix: conversationId,
        });
        return {
          messages: { ...state.messages, [conversationId]: newMsgs },
        };
      }),

    updateMessage: (conversationId, messageId, patch) =>
      set((state) => {
        const msgs = state.messages[conversationId];
        if (!msgs) return state;
        const idx = msgs.findIndex((m) => m.id === messageId);
        if (idx === -1) return state;
        const newMsgs = [...msgs];
        newMsgs[idx] = { ...newMsgs[idx], ...patch };
        return {
          messages: { ...state.messages, [conversationId]: newMsgs },
        };
      }),

    removeMessage: (conversationId, messageId) =>
      set((state) => {
        const msgs = state.messages[conversationId];
        if (!msgs) return state;
        return {
          messages: {
            ...state.messages,
            [conversationId]: msgs.filter((m) => m.id !== messageId),
          },
        };
      }),

    clearMessages: (conversationId) =>
      set((state) => {
        const { [conversationId]: _, ...rest } = state.messages;
        return { messages: rest };
      }),

    clearAllMessages: () => set({ messages: {} }),
  }),
  shallow
);

export const selectMessages = (conversationId: string) => (state: MessageState) =>
  state.messages[conversationId] ?? [];
