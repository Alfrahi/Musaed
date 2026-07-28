'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore } from '@/store';
import { useContextMenu } from '@/hooks/useContextMenu';
import { Button } from '@/components/ui/button';

interface CodeBlockProps {
  language?: string;
  value: React.ReactNode;
}

/**
 * Recursively extracts text content from React nodes for the copy-to-clipboard functionality.
 */
function extractText(node: React.ReactNode): string {
  if (!node) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');

  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    if (props.children) {
      return extractText(props.children);
    }
  }

  return '';
}

const CodeBlock = ({ language, value }: CodeBlockProps) => {
  const [copied, setCopied] = useState(false);
  const languageSetting = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(languageSetting);

  const cleanCode = useMemo(() => {
    return extractText(value).replace(/\n$/, '');
  }, [value]);

  const onCopy = () => {
    if (!cleanCode) return;
    navigator.clipboard.writeText(cleanCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const { showContextMenu } = useContextMenu({ onCopy });

  const handleContextMenu = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      showContextMenu('codeBlock', e.clientX, e.clientY, {
        copy: t('contextMenu.codeBlock.copy'),
      });
    },
    [showContextMenu, t]
  );

  const displayLanguage = language || t('common.text');

  return (
    <div
      onContextMenu={handleContextMenu}
      className="group relative my-4 block overflow-hidden rounded-none border border-zinc-200 bg-zinc-950 dark:border-zinc-800"
      role="region"
      aria-label={t('a11y.codeBlock', { language: displayLanguage })}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="caption-md font-bold tracking-widest text-zinc-500 uppercase">
            {displayLanguage}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCopy}
          className="caption-xs gap-1.5 rounded px-2 py-1 font-bold tracking-widest text-zinc-400 uppercase hover:text-white focus-visible:ring-1 focus-visible:ring-blue-500"
          aria-label={t('a11y.copyCode')}
        >
          {copied ? (
            <>
              <Check size={12} className="text-green-500" aria-hidden="true" />
              <span>{t('common.copied')}</span>
            </>
          ) : (
            <>
              <Copy size={12} aria-hidden="true" />
              <span>{t('common.copy')}</span>
            </>
          )}
        </Button>
      </div>

      <div className="overflow-x-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        <pre className="font-mono text-sm whitespace-pre text-zinc-300">
          <code>{value}</code>
        </pre>
      </div>
    </div>
  );
};

export default CodeBlock;
