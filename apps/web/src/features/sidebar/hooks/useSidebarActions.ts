'use client';

import { useCallback } from 'react';
import { useSettingsStore } from '@/features/settings/store/settings-store';
import { useTranslation } from '@/lib/i18n';
import { dialog } from '@/lib/ipc';
import { exportToMarkdown } from '@/lib/export';
import { useConversationActions } from '@/features/chat';
import { logger } from '@/lib/logger';
import { useMessageStore } from '@/features/chat/store/message-store';
import type { ConversationMetadata } from '@/features/chat/store/conversation-store';

export function useSidebarActions() {
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t, formatDate, formatNumber } = useTranslation(language);
  const { clearAllConversations, deleteConversation, updateConversationTitle } =
    useConversationActions();

  const handleClearAll = useCallback(async () => {
    const confirmed = await dialog.ask(t('sidebar.confirmClearAll'), {
      title: t('sidebar.clearAll'),
      kind: 'warning',
    });

    if (confirmed) {
      logger.info('Clearing all conversations');
      clearAllConversations();
    }
  }, [clearAllConversations, t]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      const confirmed = await dialog.ask(t('sidebar.confirmDelete'), {
        title: t('sidebar.deleteChat'),
        kind: 'warning',
      });

      if (confirmed) {
        logger.info('Deleting conversation', { id });
        deleteConversation(id);
      }
    },
    [deleteConversation, t]
  );

  const handleRenameConversation = useCallback(
    (id: string, title: string) => {
      if (title.trim()) {
        logger.debug('Renaming conversation', { id, title });
        updateConversationTitle(id, title);
      }
    },
    [updateConversationTitle]
  );

  const handleExport = useCallback(
    (conversation: ConversationMetadata) => {
      logger.info('Exporting conversation to Markdown', {
        id: conversation.id,
        title: conversation.title,
      });
      const messages = useMessageStore.getState().messages[conversation.id] || [];
      exportToMarkdown({ ...conversation, messages }, { t, formatDate, formatNumber });
    },
    [t, formatDate, formatNumber]
  );

  return {
    handleClearAll,
    handleDeleteConversation,
    handleRenameConversation,
    handleExport,
  };
}
