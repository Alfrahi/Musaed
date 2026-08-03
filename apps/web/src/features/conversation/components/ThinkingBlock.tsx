'use client';

import { useState, useEffect } from 'react';
import { Brain, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useSettingsStore } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

interface ThinkingBlockProps {
  content: string;
  isCollapsed?: boolean;
  isStreaming?: boolean;
}

const ThinkingBlock = ({
  content,
  isCollapsed: initialCollapsed = false,
  isStreaming = false,
}: ThinkingBlockProps) => {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);

  useEffect(() => {
    if (isStreaming && isCollapsed) {
      setIsCollapsed(false);
    }
  }, [isStreaming, isCollapsed]);

  useEffect(() => {
    setIsCollapsed(initialCollapsed);
  }, [initialCollapsed]);

  if (!content.trim() && !isStreaming) return null;

  return (
    <div
      className="mbs-4 mbe-4 shadow-native overflow-hidden rounded-md border border-zinc-200 bg-zinc-50/50 transition-all dark:border-zinc-800 dark:bg-zinc-900/20"
      role="region"
      aria-label={t('a11y.thinkingSection')}
      aria-busy={isStreaming}
    >
      <Button
        variant="ghost"
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="focus-ring flex w-full cursor-pointer items-center justify-between rounded-md py-2.5 ps-4 pe-4 hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
        aria-expanded={!isCollapsed}
      >
        <div className="flex items-center gap-2 text-zinc-500">
          {isStreaming ? (
            <Loader2 size={14} className="animate-spin text-blue-500" aria-hidden="true" />
          ) : (
            <Brain size={14} className="text-zinc-400" aria-hidden="true" />
          )}
          <span className="caption-md font-bold uppercase">
            {isStreaming ? t('chat.thinking') : t('chat.thoughtProcess')}
          </span>
        </div>
        <div className="text-zinc-400">
          {isCollapsed ? (
            <ChevronDown size={14} aria-hidden="true" />
          ) : (
            <ChevronUp size={14} aria-hidden="true" />
          )}
        </div>
      </Button>

      {!isCollapsed && (
        <div
          className="pbe-4 pbs-3 text-caption border-t border-zinc-100 ps-4 pe-4 font-serif leading-relaxed whitespace-pre-wrap text-zinc-500 italic dark:border-zinc-800/50 dark:text-zinc-400"
          dir="auto"
          role="status"
          aria-live={isStreaming ? 'polite' : 'off'}
        >
          {content.trim() === '' && isStreaming ? (
            <span className="opacity-50">{t('chat.thinking')}</span>
          ) : (
            content
          )}
          {isStreaming && (
            <span
              className="ms-1 inline-block h-3 w-1 animate-pulse bg-blue-500/50"
              aria-hidden="true"
            />
          )}
        </div>
      )}
    </div>
  );
};

export default ThinkingBlock;
