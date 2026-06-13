'use client';

import { useCallback, useState, useEffect, useMemo } from 'react';
import {
  useConversations,
  useConversationIds,
  useSetConversations,
  useModels,
  useGlobalSettings,
} from '../../../store/hooks';
import { useTranslation } from '../../../lib/i18n';
import { checkIsTauri, dialog, fs } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';
import toast from 'react-hot-toast';
import { ConversationSchema, type OllamaModel, type Message } from '@musaed/contracts';
import { useMessageStore } from '../../../store/stores/message-store';
import { type ConversationMetadata } from '../../../store/stores/conversation-store';

const useSizeCalculations = (
  conversations: Record<string, ConversationMetadata>,
  conversationIds: string[],
  messages: Record<string, Message[]>,
  models: OllamaModel[]
) => {
  const [historySize, setHistorySize] = useState<number | null>(null);
  const [modelsSize, setModelsSize] = useState<number | null>(null);

  const memoizedHistorySize = useMemo(() => {
    const json = JSON.stringify({ conversations, conversationIds, messages });
    return new Blob([json]).size;
  }, [conversations, conversationIds, messages]);

  const memoizedModelsSize = useMemo(() => {
    return models.reduce((acc, m) => acc + (m.size || 0), 0);
  }, [models]);

  useEffect(() => {
    setHistorySize(memoizedHistorySize);
    setModelsSize(memoizedModelsSize);
  }, [memoizedHistorySize, memoizedModelsSize]);

  return { historySize, modelsSize };
};

const useExportJson = (
  conversations: Record<string, ConversationMetadata>,
  messages: Record<string, Message[]>
) => {
  const handleExportJson = useCallback(async () => {
    const data = {
      version: 1,
      conversations: Object.values(conversations).map((c) => ({
        ...c,
        messages: messages[c.id] || [],
      })),
      exportedAt: Date.now(),
    };

    const fileName = `musaed_export_${new Date().toISOString().split('T')[0]}.json`;
    const jsonString = JSON.stringify(data, null, 2);

    if (!checkIsTauri()) {
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const filePath = await dialog.save({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      defaultPath: fileName,
    });

    if (filePath) {
      await fs.writeTextFile(filePath, jsonString);
    }
  }, [conversations, messages]);

  return handleExportJson;
};

const useExportMarkdownBundle = (
  conversations: Record<string, ConversationMetadata>,
  messages: Record<string, Message[]>,
  formatDate: (date: number | Date) => string,
  t: (key: string) => string
) => {
  const handleExportMarkdownBundle = useCallback(async () => {
    const convs = Object.values(conversations);
    if (convs.length === 0) return;

    toast.loading('Preparing bundle...', { duration: 1000 });

    const safeTitle = `musaed_bundle_${new Date().toISOString().split('T')[0]}`;
    const fileName = `${safeTitle}.md`;

    let fullMarkdown = `# Musaed Chat History Export\n\nGenerated on: ${formatDate(Date.now())}\n\n---\n\n`;

    for (const conv of convs) {
      fullMarkdown += `## ${conv.title}\n**Model:** ${conv.model}\n**Date:** ${formatDate(conv.createdAt)}\n\n`;
      const convMessages = messages[conv.id] || [];
      convMessages.forEach((msg) => {
        fullMarkdown += `### ${msg.role === 'user' ? t('export.user') : t('export.assistant')}\n${msg.content}\n\n`;
      });
      fullMarkdown += `\n---\n\n`;
    }

    if (!checkIsTauri()) {
      const blob = new Blob([fullMarkdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const filePath = await dialog.save({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: fileName,
    });

    if (filePath) {
      await fs.writeTextFile(filePath, fullMarkdown);
    }
  }, [conversations, messages, formatDate, t]);

  return handleExportMarkdownBundle;
};

const validateAndSetConversations = (
  raw: unknown,
  setConversations: (conversations: ConversationMetadata[]) => void,
  setMessages: (conversationId: string, messages: Message[]) => void,
  t: (key: string) => string
) => {
  try {
    if (
      raw &&
      typeof raw === 'object' &&
      'conversations' in raw &&
      Array.isArray(raw.conversations)
    ) {
      const validated = raw.conversations.map((c: unknown) => ConversationSchema.parse(c));

      // Separate metadata and messages
      const metadata = validated.map(({ messages: _, ...m }) => m);
      setConversations(metadata);

      validated.forEach((c) => {
        setMessages(c.id, c.messages);
      });

      toast.success(t('settings.storage.importSuccess'));
    } else {
      throw new Error('Invalid format');
    }
  } catch (err) {
    logger.error('Import failed', { error: err });
    toast.error(t('settings.storage.importError'));
  }
};

const handleTauriImport = async (
  setConversations: (conversations: ConversationMetadata[]) => void,
  setMessages: (conversationId: string, messages: Message[]) => void,
  t: (key: string) => string
) => {
  const selected = await dialog.open({
    multiple: false,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!selected || Array.isArray(selected)) return;
  const content = await fs.readTextFile(selected);
  if (content === null) return;
  const raw = JSON.parse(content);
  validateAndSetConversations(raw, setConversations, setMessages, t);
};

const handleWebImport = (
  setConversations: (conversations: ConversationMetadata[]) => void,
  setMessages: (conversationId: string, messages: Message[]) => void,
  t: (key: string) => string
) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const raw = JSON.parse(event.target?.result as string);
      validateAndSetConversations(raw, setConversations, setMessages, t);
    };
    reader.readAsText(file);
  };
  input.click();
};

const useImportJson = (
  setConversations: (conversations: ConversationMetadata[]) => void,
  setMessages: (conversationId: string, messages: Message[]) => void,
  t: (key: string) => string
) => {
  const handleImportJson = useCallback(async () => {
    const confirmed = await dialog.ask(t('settings.storage.confirmImport'), {
      title: t('settings.storage.importData'),
      kind: 'warning',
    });

    if (!confirmed) return;

    if (checkIsTauri()) {
      await handleTauriImport(setConversations, setMessages, t);
    } else {
      handleWebImport(setConversations, setMessages, t);
    }
  }, [setConversations, setMessages, t]);

  return handleImportJson;
};

export function useStorageActions() {
  const conversations = useConversations();
  const conversationIds = useConversationIds();
  const setConversations = useSetConversations();
  const messages = useMessageStore((s) => s.messages);
  const setMessages = useMessageStore((s) => s.setMessages);
  const models = useModels();
  const globalSettings = useGlobalSettings();
  const { t, formatDate } = useTranslation(globalSettings.language);

  const { historySize, modelsSize } = useSizeCalculations(
    conversations,
    conversationIds,
    messages,
    models
  );
  const handleExportJson = useExportJson(conversations, messages);
  const handleExportMarkdownBundle = useExportMarkdownBundle(
    conversations,
    messages,
    formatDate,
    t
  );
  const handleImportJson = useImportJson(setConversations, setMessages, t);

  return {
    historySize,
    modelsSize,
    handleExportJson,
    handleExportMarkdownBundle,
    handleImportJson,
  };
}
