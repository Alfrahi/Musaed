"use client";

import { useCallback } from 'react';
import { useConversationStore, useSettingsStore } from '../../../store';
import { logger } from '../../../lib/logger';

export function useStorageCleanup() {
  const { conversations, conversationIds, setConversations } = useConversationStore();
  const { globalSettings } = useSettingsStore();

  const runCleanup = useCallback(() => {
    const days = globalSettings.chatRetentionDays;
    if (days <= 0) return;

    const now = Date.now();
    const threshold = now - (days * 24 * 60 * 60 * 1000);

    const currentList = conversationIds.map(id => conversations[id]).filter(Boolean);
    const validConvs = currentList.filter(conv => conv.updatedAt >= threshold);
    const removedCount = currentList.length - validConvs.length;

    if (removedCount > 0) {
      logger.info('Auto-cleanup executed', { removedCount, retentionDays: days });
      setConversations(validConvs);
    }
  }, [conversations, conversationIds, setConversations, globalSettings.chatRetentionDays]);

  return { runCleanup };
}