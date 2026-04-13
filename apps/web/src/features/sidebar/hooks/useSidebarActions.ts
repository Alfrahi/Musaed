"use client";

import { useCallback } from 'react';
import { useConversationStore, useSettingsStore } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { dialog } from '@/lib/ipc';
import { exportToMarkdown } from '@/lib/export';
import { Conversation } from '@musaed/contracts';
import { useConversationActions } from '@/features/chat';
import { logger } from '@/lib/logger';

export function useSidebarActions() {
  const { globalSettings } = useSettingsStore();
  const { t, formatDate, formatNumber } = useTranslation(globalSettings.language);
  const { clearAllConversations, deleteConversation, updateConversationTitle } = useConversationActions();

  const handleClearAll = useCallback(async () => {
    const confirmed = await dialog.ask(t('sidebar.confirmClearAll'), { 
      title: t('sidebar.clearAll'), 
      kind: 'warning' 
    });
    
    if (confirmed) {
      logger.info('Clearing all conversations');
      clearAllConversations();
    }
  }, [clearAllConversations, t]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    const confirmed = await dialog.ask(t('sidebar.confirmDelete'), { 
      title: t('sidebar.deleteChat'), 
      kind: 'warning' 
    });

    if (confirmed) {
      logger.info('Deleting conversation', { id });
      deleteConversation(id);
    }
  }, [deleteConversation, t]);

  const handleRenameConversation = useCallback((id: string, title: string) => {
    if (title.trim()) {
      logger.debug('Renaming conversation', { id, title });
      updateConversationTitle(id, title);
    }
  }, [updateConversationTitle]);

  const handleExport = useCallback((conversation: Conversation) => {
    logger.info('Exporting conversation to Markdown', { id: conversation.id, title: conversation.title });
    exportToMarkdown(conversation, { t, formatDate, formatNumber });
  }, [t, formatDate, formatNumber]);

  return {
    handleClearAll,
    handleDeleteConversation,
    handleRenameConversation,
    handleExport
  };
}