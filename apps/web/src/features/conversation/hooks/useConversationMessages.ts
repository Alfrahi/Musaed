'use client';

import { useEffect, useRef } from 'react';
import { useConversationStore } from '../store/conversation-store';
import { useMessageStore } from '../store/message-store';
import { conversationApi } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';

/**
 * Hook that loads messages from the Rust backend when the user switches
 * to a different conversation. Only fetches if messages are not already
 * cached in the message store.
 */
export function useConversationMessages() {
  const loadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentConversationId = useConversationStore.getState().currentConversationId;
    if (!currentConversationId) return;

    // Skip if already loaded in this session
    if (loadedRef.current.has(currentConversationId)) return;

    // Skip if messages are already cached (e.g. from current session activity)
    const existingMessages = useMessageStore.getState().messages[currentConversationId];
    if (existingMessages && existingMessages.length > 0) return;

    let cancelled = false;

    (async () => {
      try {
        const fullConv = await conversationApi.getConversation(currentConversationId);
        if (!cancelled && fullConv && fullConv.messages.length > 0) {
          useMessageStore.getState().setMessages(currentConversationId, fullConv.messages);
        }
        if (!cancelled) {
          loadedRef.current.add(currentConversationId);
        }
      } catch (err) {
        logger.warn('Failed to load messages for conversation', {
          conversationId: currentConversationId,
          error: err,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
