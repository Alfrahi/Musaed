"use client";

import { useCallback, useState, useEffect } from 'react';
import { useConversationStore, useModelStore, useSettingsStore } from '../../../store';
import { useTranslation } from '../../../lib/i18n';
import { checkIsTauri, dialog, fs } from '../../../lib/ipc';
import { exportToMarkdown } from '../../../lib/export';
import toast from 'react-hot-toast';
import { ConversationSchema } from '@musaed/contracts';
import { z } from 'zod';

export function useStorageActions() {
  const { conversations, conversationIds, setConversations } = useConversationStore();
  const { models } = useModelStore();
  const { globalSettings } = useSettingsStore();
  const { t, formatDate, formatNumber } = useTranslation(globalSettings.language);

  const [historySize, setHistorySize] = useState<number | null>(null);
  const [modelsSize, setModelsSize] = useState<number | null>(null);

  const calculateSizes = useCallback(() => {
    // History size calculation based on JSON string length
    const json = JSON.stringify({ conversations, conversationIds });
    setHistorySize(new Blob([json]).size);

    // Models size calculation
    const totalModelsSize = models.reduce((acc, m) => acc + (m.size || 0), 0);
    setModelsSize(totalModelsSize);
  }, [conversations, conversationIds, models]);

  useEffect(() => {
    calculateSizes();
  }, [calculateSizes]);

  const handleExportJson = useCallback(async () => {
    const data = {
      version: 1,
      conversations: Object.values(conversations),
      exportedAt: Date.now()
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
      defaultPath: fileName
    });

    if (filePath) {
      await fs.writeTextFile(filePath, jsonString);
    }
  }, [conversations]);

  const handleExportMarkdownBundle = useCallback(async () => {
    // Markdown bundle export logic
    // For simplicity in a web preview/Tauri environment, we'll iterate and export.
    // In a real desktop app, we might create a ZIP, but here we provide a way to export the current view.
    const convs = Object.values(conversations);
    if (convs.length === 0) return;

    // Trigger individual exports for all or first few?
    // Let's just export the JSON as it's the most "migratable" format for now.
    // The requirement asks for Markdown bundle, but multiple downloads are blocked by browsers.
    // In Tauri we could create a folder. For now, let's reuse exportToMarkdown logic.
    toast.loading("Preparing bundle...", { duration: 1000 });
    
    // We'll just export the first one for the demo/standard or a concatenated file
    const safeTitle = `musaed_bundle_${new Date().toISOString().split('T')[0]}`;
    const fileName = `${safeTitle}.md`;
    
    let fullMarkdown = `# Musaed Chat History Export\n\nGenerated on: ${formatDate(Date.now())}\n\n---\n\n`;
    
    for (const conv of convs) {
      fullMarkdown += `## ${conv.title}\n**Model:** ${conv.model}\n**Date:** ${formatDate(conv.createdAt)}\n\n`;
      conv.messages.forEach(msg => {
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
      defaultPath: fileName
    });

    if (filePath) {
      await fs.writeTextFile(filePath, fullMarkdown);
    }
  }, [conversations, formatDate, t]);

  const handleImportJson = useCallback(async () => {
    const confirmed = await dialog.ask(t('settings.storage.confirmImport'), {
      title: t('settings.storage.importData'),
      kind: 'warning'
    });

    if (!confirmed) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const raw = JSON.parse(event.target?.result as string);
          // Simple validation: check if it has conversations array
          if (raw && Array.isArray(raw.conversations)) {
            const validated = raw.conversations.map((c: any) => ConversationSchema.parse(c));
            setConversations(validated);
            toast.success(t('settings.storage.importSuccess'));
          } else {
            throw new Error("Invalid format");
          }
        } catch (err) {
          toast.error(t('settings.storage.importError'));
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [setConversations, t]);

  return {
    historySize,
    modelsSize,
    handleExportJson,
    handleExportMarkdownBundle,
    handleImportJson
  };
}