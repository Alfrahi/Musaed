"use client";

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useTranslation } from '../../../lib/i18n';
import { useSettingsStore } from '../../../store';

interface CodeBlockProps {
  language?: string;
  value: string;
}

const CodeBlock = ({ language, value }: CodeBlockProps) => {
  const [copied, setCopied] = useState(false);
  const { globalSettings } = useSettingsStore();
  const { t } = useTranslation(globalSettings.language);

  const onCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayLanguage = language || t('common.text');

  return (
    <span className="block relative group mbs-4 mbe-4 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950" role="region" aria-label={t('a11y.codeBlock', { language: language || t('common.code') })}>
      <span className="flex items-center justify-between ps-4 pe-4 py-2 bg-zinc-900 border-b border-zinc-800">
        <span className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {displayLanguage}
          </span>
        </span>
        <span className="flex items-center gap-3">
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors focus-visible:ring-1 focus-visible:ring-blue-500 outline-none rounded ps-1 pe-1 py-0.5"
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
        </span>
      </span>
      <span className="block p-4 overflow-x-auto focus-visible:ring-2 focus-visible:ring-blue-500 outline-none" tabIndex={0}>
        <code className={cn("text-sm font-mono text-zinc-300", language)}>
          {value}
        </code>
      </span>
    </span>
  );
};

export default CodeBlock;