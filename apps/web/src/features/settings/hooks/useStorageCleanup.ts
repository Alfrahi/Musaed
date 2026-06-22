'use client';

import { useCallback } from 'react';
import {
  useConversations,
  useConversationIds,
  useSetConversations,
} from '@/features/conversation/store/conversation-store';
import { useChatRetentionDays } from '../store/settings-store';
import { useMessageStore } from '@/features/conversation/store/message-store';
import { logger } from '../../../lib/logger';

export function useStorageCleanup() {
  const conversations = useConversations();
  const conversationIds = useConversationIds();
  const setConversations = useSetConversations();
  const chatRetentionDays = useChatRetentionDays();

  const runCleanup = useCallback(() => {
    const days = chatRetentionDays;
    if (days <= 0) return;

    const now = Date.now();
    const threshold = now - days * 24 * 60 * 60 * 1000;

    const currentList = conversationIds.map((id) => conversations[id]).filter(Boolean);
    const validConvs = currentList.filter((conv) => conv.updatedAt >= threshold);
    const removedCount = currentList.length - validConvs.length;

    if (removedCount > 0) {
      logger.info('Auto-cleanup executed', { removedCount, retentionDays: days });

      // Identify removed IDs to clean up their messages
      const validIds = new Set(validConvs.map((c) => c.id));
      const removedIds = conversationIds.filter((id) => !validIds.has(id));

      setConversations(validConvs);

      // Clean up orphaned messages
      const messageStore = useMessageStore.getState();
      removedIds.forEach((id) => messageStore.clearMessages(id));
    }
  }, [conversations, conversationIds, setConversations, chatRetentionDays]);

  return { runCleanup };
}
