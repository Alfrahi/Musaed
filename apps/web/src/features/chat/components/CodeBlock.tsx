"use client";

import React, { useState, useMemo } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useTranslation } from '../../../lib/i18n';
import { useSettingsStore } from '../../../store';

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
  const { globalSettings } = useSettingsStore();
  const { t } = useTranslation(globalSettings.language);

  const cleanCode = useMemo(() => {
    return extractText(value).replace(/\n$/, '');
  }, [value]);

  const onCopy = () => {
    if (!cleanCode) return;
    navigator.clipboard.writeText(cleanCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayLanguage = language || t('common.text');

  return (
    <div 
      className="block relative group my-4 rounded-none overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950"
      role="region"
      aria-label={t('a11y.codeBlock', { language: displayLanguage })}
    >
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {displayLanguage}
          </span>
        </div>
        <button 
          onClick={onCopy}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors focus-visible:ring-1 focus-visible:ring-blue-500 outline-none rounded px-2 py-1"
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
        </button>
      </div>

      <div className="p-4 overflow-x-auto focus-visible:ring-2 focus-visible:ring-blue-500 outline-none">
        <pre className="text-sm font-mono text-zinc-300 whitespace-pre">
          <code>{value}</code>
        </pre>
      </div>
    </div>
  );
};

export default CodeBlock;