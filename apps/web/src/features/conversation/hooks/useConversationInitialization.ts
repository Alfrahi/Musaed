'use client';

import { useCallback } from 'react';
import { useConversationStore } from '@/store/conversation-store';
import { useMessageStore } from '@/store/message-store';
import { useConversationActions } from './useConversationActions';
import { initializeConversations } from '../utils/conversation-backend';
import {
  getLastActiveConversationId,
  setLastActiveConversationId,
} from '../utils/last-active-conversation';
import { conversationApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';

/**
 * Boot-phase initialization for the conversation feature.
 *
 * Loads persisted conversations from the Rust backend, hydrates the store,
 * loads messages for the most recent conversation, or creates a default
 * conversation if none exist.
 *
 * Extracted from the monolithic `useAppInitialization` orchestrator so each
 * feature owns its own init sequence. Called once at app startup.
 */
export function useConversationInitialization() {
  const { createNewConversation } = useConversationActions();

  const initialize = useCallback(async () => {
    const conversations = await initializeConversations();
    if (conversations && conversations.length > 0) {
      const { batchUpdate } = useConversationStore.getState();
      // Prefer the last active conversation (persisted in localStorage) if it
      // still exists. Fall back to the most recent conversation (conversations[0],
      // ordered by updated_at DESC — see the list_conversations ordering invariant).
      const lastActiveId = getLastActiveConversationId();
      const restoredId =
        lastActiveId && conversations.some((c) => c.id === lastActiveId)
          ? lastActiveId
          : conversations[0].id;
      const activeId = restoredId;
      batchUpdate(() => ({
        conversations: Object.fromEntries(conversations.map((c) => [c.id, c])),
        conversationIds: conversations.map((c) => c.id),
        currentConversationId: activeId,
      }));
      setLastActiveConversationId(activeId);

      // Load messages for the active conversation
      try {
        const fullConv = await conversationApi.getConversation(activeId);
        if (fullConv && fullConv.messages.length > 0) {
          useMessageStore.getState().setMessages(activeId, fullConv.messages);
        }
      } catch (msgErr) {
        logger.warn('Failed to load messages for initial conversation', { error: msgErr });
      }
    } else {
      createNewConversation();
    }
  }, [createNewConversation]);

  return { initialize };
}
