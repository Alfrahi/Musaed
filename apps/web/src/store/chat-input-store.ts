'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';

/**
 * Lightweight store for cross-component chat-input coordination.
 * Used by MessageBubble's "Edit prompt" / "Edit" hover actions to signal
 * the InputArea to populate its textarea with a given prompt (Prompt 14).
 *
 * This is intentionally NOT persisted — it's ephemeral UI coordination state.
 */
interface ChatInputState {
  /** When non-null, InputArea should set its textarea to this value and
   *  then clear it (one-shot signal). */
  editPrompt: string | null;
  setEditPrompt: (prompt: string | null) => void;
}

export const useChatInputStore = createWithEqualityFn<ChatInputState>()(
  (set) => ({
    editPrompt: null,
    setEditPrompt: (prompt) => set({ editPrompt: prompt }),
  }),
  shallow
);
