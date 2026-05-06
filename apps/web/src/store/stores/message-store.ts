'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Message } from '@musaed/contracts';
import { createTauriStorage } from '../../lib/tauri-storage';

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
  persist(
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
            messages: {
              ...state.messages,
              [conversationId]: newMsgs,
            },
          };
        }),

      clearMessages: (conversationId) =>
        set((state) => {
          const { [conversationId]: _, ...rest } = state.messages;
          return { messages: rest };
        }),
    }),
    {
      name: 'musaed-messages-storage',
      storage: createJSONStorage(() => createTauriStorage('messages-state.json')),
    }
  ),
  shallow
);

export const selectMessages = (conversationId: string) => (state: MessageState) =>
  state.messages[conversationId] ?? [];
