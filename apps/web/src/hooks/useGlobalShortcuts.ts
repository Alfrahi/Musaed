'use client';

import { useEffect } from 'react';
import { useConversationActions } from '@/features/conversation';
import { stopStream } from '@/store/coordination';
import { chatApi } from '@/lib/ipc';
import { useOpenModal, useCloseModal } from '@/store/hooks';
import { selectIsAnyModalOpen, useUIStore } from '@/store/ui-store';
import { useConversationStore } from '@/store/conversation-store';
import { useStreamingStore } from '@/store/streaming-store';

/**
 * Hook to register global keyboard shortcuts for primary application actions.
 *
 * Actions:
 * - Cmd/Ctrl + N: New Chat
 * - Cmd/Ctrl + ,: Settings
 * - Cmd/Ctrl + L: Model Library
 * - Cmd/Ctrl + /: Keyboard shortcuts cheatsheet
 * - Cmd/Ctrl + K: Command palette
 * - Cmd/Ctrl + F: Search
 * - Escape: if any modal is open, close it; otherwise, if the active
 *   conversation is streaming, stop the stream. The two branches are mutually
 *   exclusive so Escape never double-fires (Escape-to-stop contract).
 */
export function useGlobalShortcuts() {
  const { createNewConversation } = useConversationActions();
  const openModal = useOpenModal();
  const closeModal = useCloseModal();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        createNewConversation();
      }

      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        openModal('settings');
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        openModal('library');
      }

      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        openModal('cheatsheet');
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openModal('commandPalette');
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        openModal('search');
      }

      if (e.key === 'Escape') {
        // Modal-first routing: read state straight from the store so Escape
        // routing stays current without re-running this effect on every toggle.
        const anyModalOpen = selectIsAnyModalOpen(useUIStore.getState());
        if (anyModalOpen) {
          closeModal();
          return;
        }

        // No modal is intercepting Escape — route to the streaming stop
        // contract. Read the active conversation + streaming state directly
        // from the stores to avoid stale closure captures.
        const conversationId = useConversationStore.getState().currentConversationId;
        if (!conversationId) return;
        const activeStreams = useStreamingStore.getState().activeStreams;
        if (conversationId in activeStreams) {
          const requestId = activeStreams[conversationId];
          chatApi.abort(requestId);
          // Pass the requestId so stopStream bails out if a
          // new stream has replaced the old one before this call runs
          // (abort race).
          stopStream(conversationId, 'abort', requestId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createNewConversation, openModal, closeModal]);
}
