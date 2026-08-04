'use client';

import { useCallback, useMemo } from 'react';
import { useMessageStore } from '@/store/message-store';
import { useSettingsStore, useModelStore, useConversationStore } from '@/store';
import { useSetGlobalSettings } from '@/store/settings-store';
import { useConversationActions } from '@/features/conversation';
import {
  useSetLibraryOpen,
  useSetSettingsOpen,
  useSetInfoOpen,
  useSetCheatsheetOpen,
} from '@/store/hooks';
import { exportToMarkdown } from '@/features/sidebar';
import { useTranslation } from '@/lib/i18n';
import { buildCommands, type Command, type CommandCallbacks } from '../utils/build-commands';

/**
 * Build the full CommandPalette command list from live store state.
 *
 * Encapsulates the callback plumbing (store setters, conversation actions,
 * export helper) so the {@link CommandPalette} component body stays within the
 * project's `max-lines-per-function` lint budget.
 */
export function useCommands(onClose: () => void): Command[] {
  const globalSettings = useSettingsStore((s) => s.globalSettings);
  const { t, formatDate, formatNumber } = useTranslation(globalSettings.language);
  const { createNewConversation, clearAllConversations } = useConversationActions();
  const setLibraryOpen = useSetLibraryOpen();
  const setSettingsOpen = useSetSettingsOpen();
  const setInfoOpen = useSetInfoOpen();
  const setCheatsheetOpen = useSetCheatsheetOpen();
  const setGlobalSettings = useSetGlobalSettings();
  const models = useModelStore((s) => s.models);
  const conversations = useConversationStore((s) => s.conversations);
  const conversationIds = useConversationStore((s) => s.conversationIds);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);

  const exportCurrentChat = useCallback(() => {
    if (!currentConversationId) return;
    const conv = conversations[currentConversationId];
    if (!conv) return;
    const messages = useMessageStore.getState().messages[currentConversationId] || [];
    exportToMarkdown({ ...conv, messages }, { t, formatDate, formatNumber });
  }, [currentConversationId, conversations, t, formatDate, formatNumber]);

  const updateGlobalSettings = useCallback(
    (update: Record<string, unknown>) => {
      setGlobalSettings({ ...globalSettings, ...update });
    },
    [globalSettings, setGlobalSettings]
  );

  return useMemo(
    () =>
      buildCommands(
        t,
        {
          createNewConversation,
          setLibraryOpen,
          setSettingsOpen,
          setInfoOpen,
          setCheatsheetOpen,
          setCurrentConversationId: useConversationStore.getState().setCurrentConversationId,
          setSelectedModel: useModelStore.getState().setSelectedModel,
          updateGlobalSettings,
          clearAllConversations,
          exportCurrentChat,
        } satisfies CommandCallbacks,
        models.map((m) => m.name),
        conversations,
        conversationIds,
        globalSettings.theme,
        globalSettings.language,
        onClose
      ),
    [
      t,
      createNewConversation,
      setLibraryOpen,
      setSettingsOpen,
      setInfoOpen,
      setCheatsheetOpen,
      updateGlobalSettings,
      clearAllConversations,
      exportCurrentChat,
      models,
      conversations,
      conversationIds,
      globalSettings.theme,
      globalSettings.language,
      onClose,
    ]
  );
}
