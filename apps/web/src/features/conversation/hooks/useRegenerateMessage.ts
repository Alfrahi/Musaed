'use client';

import { useCallback } from 'react';
import { useUIStore } from '@/store/ui-store';
import type { Message } from '@musaed/contracts';

/**
 * Returns a `regenerateMessage` callback that finds the last user message
 * before the given assistant message and re-invokes `sendMessage` with its
 * content. Used by the context menu on assistant bubbles.
 */
export function useRegenerateMessage(
  currentConversationId: string | null,
  messages: Message[],
  sendMessage: (input: string, images?: string[]) => void
) {
  const regenerateMessage = useCallback(
    (assistantMsgId: string) => {
      if (!currentConversationId) return;
      const assistantIdx = messages.findIndex((m) => m.id === assistantMsgId);
      if (assistantIdx === -1) return;
      // Walk backward from the assistant message to find the preceding user message
      const lastUser = messages.slice(0, assistantIdx).findLast((m) => m.role === 'user');
      if (!lastUser) return;
      useUIStore.getState().setErrorMessage(null);
      void sendMessage(lastUser.content, lastUser.images ?? []);
    },
    [currentConversationId, messages, sendMessage]
  );

  return { regenerateMessage };
}
