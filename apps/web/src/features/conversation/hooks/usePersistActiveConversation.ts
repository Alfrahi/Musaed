'use client';

import { useEffect } from 'react';
import { useCurrentConversationId } from '@/store/conversation-store';
import {
  setLastActiveConversationId,
  clearLastActiveConversationId,
} from '../utils/last-active-conversation';

/**
 * Persist `currentConversationId` to localStorage whenever it changes.
 *
 * Covers all write paths — whether through the `setCurrentConversationId`
 * setter or `batchUpdate` — by observing the store reactively rather than
 * hooking a specific setter. Restored on the next launch by
 * `useConversationInitialization`.
 */
export function usePersistActiveConversation() {
  const currentConversationId = useCurrentConversationId();

  useEffect(() => {
    if (currentConversationId) {
      setLastActiveConversationId(currentConversationId);
    } else {
      clearLastActiveConversationId();
    }
  }, [currentConversationId]);
}
