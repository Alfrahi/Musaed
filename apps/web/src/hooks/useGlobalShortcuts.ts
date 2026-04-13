"use client";

import { useEffect } from 'react';
import { useConversationActions } from '../features/chat';
import { useUIStore } from '../store';

export function useGlobalShortcuts() {
  const { createNewConversation } = useConversationActions();
  const { setSettingsOpen, setLibraryOpen } = useUIStore();

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
      
      if (e.key === 'Escape') {
        setSettingsOpen(false);
        setLibraryOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createNewConversation, setSettingsOpen, setLibraryOpen]);
}