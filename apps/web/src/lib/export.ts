'use client';

import { type Conversation, stripRedactedThinkingBlocks } from '@musaed/contracts';
import { dialog, fs, checkIsTauri } from './ipc';

interface ExportContext {
  t: (key: string) => string;
  formatDate: (date: number | Date) => string;
  formatNumber: (num: number, options?: Intl.NumberFormatOptions) => string;
}

/**
 * Sanitizes a string for use as a filename while preserving Unicode (Arabic, etc.)
 */
const sanitizeFilename = (title: string): string => {
  // Remove control characters and illegal filename characters: \ / : * ? " < > |
  // Also trim and replace multiple spaces/underscores with a single one
  return title
    .replace(/[\\/:*?"<>|\x00-\x1F\x80-\x9F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim();
};

export const exportToMarkdown = async (conversation: Conversation, context: ExportContext) => {
  const { t, formatDate, formatNumber } = context;

  let markdown = `# ${conversation.title}\n\n`;
  markdown += `**${t('export.model')}:** ${conversation.model}\n`;
  markdown += `**${t('export.date')}:** ${formatDate(conversation.createdAt)}\n\n`;
  markdown += `---\n\n`;

  conversation.messages.forEach((msg) => {
    const role = msg.role === 'user' ? t('export.user') : t('export.assistant');

    const cleanContent = stripRedactedThinkingBlocks(msg.content);

    if (cleanContent) {
      markdown += `### ${role}\n\n${cleanContent}\n\n`;

      if (msg.eval_count && msg.total_duration) {
        const speed = msg.eval_count / (msg.total_duration / 1e9);
        const speedStr = formatNumber(speed, { maximumFractionDigits: 1 });
        markdown += `*${t('export.stats')}: ${formatNumber(msg.eval_count)} ${t('export.tokens')}, ${speedStr} ${t('export.ts')}*\n\n`;
      }
    }
  });

  const safeTitle = sanitizeFilename(conversation.title || 'chat');
  const fileName = `${safeTitle}.md`;

  if (!checkIsTauri()) {
    const blob = new Blob([markdown], { type: 'text/markdown' });
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
    await fs.writeTextFile(filePath, markdown);
  }
};
