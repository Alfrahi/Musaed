"use client";

import { useState, useEffect } from 'react';
import { Brain, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useSettingsStore } from '../../../store';
import { useTranslation } from '../../../lib/i18n';

interface ThinkingBlockProps {
  content: string;
  isCollapsed?: boolean;
  isStreaming?: boolean;
}

const ThinkingBlock = ({ content, isCollapsed: initialCollapsed = false, isStreaming = false }: ThinkingBlockProps) => {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const { globalSettings } = useSettingsStore();
  const { t } = useTranslation(globalSettings.language);

  useEffect(() => {
    if (isStreaming && isCollapsed) {
      setIsCollapsed(false);
    }
  }, [isStreaming]);

  useEffect(() => {
    setIsCollapsed(initialCollapsed);
  }, [initialCollapsed]);

  if (!content.trim() && !isStreaming) return null;

  return (
    <div 
      className="mbs-4 mbe-4 rounded-none border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20 overflow-hidden transition-all shadow-sm"
      role="region"
      aria-label={t('a11y.thinkingSection')}
    >
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between ps-4 pe-4 py-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 outline-none"
        aria-expanded={!isCollapsed}
      >
        <div className="flex items-center gap-2 text-zinc-500">
          {isStreaming ? (
            <Loader2 size={14} className="animate-spin text-blue-500" aria-hidden="true" />
          ) : (
            <Brain size={14} className="text-zinc-400" aria-hidden="true" />
          )}
          <span className="text-[10px] font-bold uppercase tracking-widest">
            {isStreaming ? t('chat.thinking') : t('chat.thoughtProcess')}
          </span>
        </div>
        <div className="text-zinc-400">
          {isCollapsed ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
        </div>
      </button>
      
      {!isCollapsed && (
        <div 
          className="ps-4 pe-4 pbe-4 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 italic border-t border-zinc-100 dark:border-zinc-800/50 pbs-3 whitespace-pre-wrap font-serif"
          dir="auto"
          aria-live={isStreaming ? "polite" : "off"}
        >
          {content.trim() === '' && isStreaming ? (
            <span className="opacity-50">{t('chat.thinking')}</span>
          ) : (
            content
          )}
          {isStreaming && <span className="inline-block w-1 h-3 ms-1 bg-blue-500/50 animate-pulse" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
};

export default ThinkingBlock;