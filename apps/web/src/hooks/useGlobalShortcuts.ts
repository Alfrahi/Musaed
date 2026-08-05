'use client';

import { useEffect } from 'react';
import { useConversationActions } from '@/features/conversation';
import { stopStreamForConversation } from '@/store/coordination';
import { chatApi } from '@/lib/ipc';
import {
  useSetSettingsOpen,
  useSetLibraryOpen,
  useSetInfoOpen,
  useSetCheatsheetOpen,
  useSetCommandPaletteOpen,
  useSetSearchOpen,
} from '@/store/hooks';
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
 * - Escape: if any modal is open, close modals; otherwise, if the active
 *   conversation is streaming, stop the stream. The two branches are mutually
 *   exclusive so Escape never double-fires (audit F6 — Escape-to-stop contract).
 */
export function useGlobalShortcuts() {
  const { createNewConversation } = useConversationActions();
  const setSettingsOpen = useSetSettingsOpen();
  const setLibraryOpen = useSetLibraryOpen();
  const setInfoOpen = useSetInfoOpen();
  const setCheatsheetOpen = useSetCheatsheetOpen();
  const setCommandPaletteOpen = useSetCommandPaletteOpen();
  const setSearchOpen = useSetSearchOpen();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        createNewConversation();
      }

      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        setLibraryOpen(true);
      }

      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setCheatsheetOpen(true);
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      }

      if (e.key === 'Escape') {
        // Modal-first routing: read state straight from the store so Escape
        // routing stays current without re-running this effect on every toggle.
        const anyModalOpen = selectIsAnyModalOpen(useUIStore.getState());
        if (anyModalOpen) {
          setSettingsOpen(false);
          setLibraryOpen(false);
          setInfoOpen(false);
          setCheatsheetOpen(false);
          setCommandPaletteOpen(false);
          setSearchOpen(false);
          return;
        }

        // No modal is intercepting Escape — route to the streaming stop
        // contract. Read the active conversation + streaming state directly
        // from the stores to avoid stale closure captures.
        const conversationId = useConversationStore.getState().currentConversationId;
        if (!conversationId) return;
        const activeStreams = useStreamingStore.getState().activeStreams;
        if (conversationId in activeStreams) {
          chatApi.abort(activeStreams[conversationId]);
          stopStreamForConversation(conversationId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    createNewConversation,
    setSettingsOpen,
    setLibraryOpen,
    setInfoOpen,
    setCheatsheetOpen,
    setCommandPaletteOpen,
    setSearchOpen,
  ]);
}
