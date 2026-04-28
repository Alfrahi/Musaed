"use client";

import { useEffect } from 'react';
import { X, Terminal, RefreshCw, Trash2 } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { cn } from '../../../lib/utils';
import { useLanguage } from '../../../store/hooks';
import { useTranslation } from '../../../lib/i18n';
import { useLogActions } from '../hooks/useLogActions';
import { ModalLayout } from '@/components/ui';

interface LogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

const LogViewer = ({ isOpen, onClose }: LogViewerProps) => {
  const language = useLanguage();
  const { t, formatDate } = useTranslation(language);
  const { logs, isLoading, fetchLogs, clearLogs } = useLogActions();

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, fetchLogs]);

  const renderLogRow = (index: number, log: string) => {
    try {
      const parsed = JSON.parse(log);
      const levelClasses = 
        parsed.level === 'error' ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-400/10' : 
        parsed.level === 'warn' ? 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-400/10' : 
        'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-400/10';
      
      return (
        <div className="flex gap-3 py-3 ps-6 pe-6 border-b border-zinc-100 dark:border-zinc-800/50 font-mono text-[11px]" role="listitem">
          <span className="text-zinc-400 dark:text-zinc-600 shrink-0">
            [{formatDate(new Date(parsed.timestamp), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}]
          </span>
          <span className={cn("px-1.5 rounded text-[9px] font-bold uppercase shrink-0 h-fit mbs-0.5", levelClasses)}>
            {parsed.level}
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-zinc-700 dark:text-zinc-300 break-words">{parsed.message}</span>
            {parsed.context && (
              <pre className="mbs-1.5 p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg text-[9px] text-zinc-500 dark:text-zinc-400 overflow-x-auto border border-zinc-100 dark:border-zinc-800" tabIndex={0}>
                {JSON.stringify(parsed.context, null, 2)}
              </pre>
            )}
          </div>
        </div>
      );
    } catch {
      return (
        <div className="text-zinc-500 py-3 ps-6 pe-6 border-b border-zinc-100 dark:border-zinc-800/50 font-mono text-[11px]" role="listitem">
          {log}
        </div>
      );
    }
  };

  return (
    <ModalLayout isOpen={isOpen} onClose={onClose} maxWidth="max-w-4xl" className="h-[80vh]" zIndex="z-[70]">
      <div className="flex items-center justify-between pbs-6 pbe-6 ps-6 pe-6 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
            <Terminal size={20} aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-900 dark:white tracking-tight">{t('logs.title')}</h2>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{t('logs.debuggingHub')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={fetchLogs} 
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl text-zinc-500 transition-all focus-visible:ring-2 focus-visible:ring-blue-500 outline-none"
            title={t('logs.refreshLogs')}
          >
            <RefreshCw size={20} className={cn(isLoading && "animate-spin text-blue-500")} aria-hidden="true" />
          </button>
          <button 
            onClick={clearLogs} 
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl text-zinc-500 hover:text-red-500 transition-all focus-visible:ring-2 focus-visible:ring-red-500 outline-none"
            title={t('logs.clearLogs')}
          >
            <Trash2 size={20} aria-hidden="true" />
          </button>
          <button 
            onClick={onClose} 
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl text-zinc-500 transition-all focus-visible:ring-2 focus-visible:ring-blue-500 outline-none"
            aria-label={t('a11y.closeModal')}
          >
            <X size={24} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-white dark:bg-zinc-950/50 overflow-hidden" role="list">
        {logs.length > 0 ? (
          <Virtuoso
            className="h-full"
            data={logs}
            itemContent={(index, log) => renderLogRow(index, log)}
            initialTopMostItemIndex={logs.length > 0 ? logs.length - 1 : 0}
            followOutput="smooth"
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-600 space-y-4">
            <Terminal size={48} className="opacity-10" aria-hidden="true" />
            <p className="text-sm font-medium italic">{t('logs.noLogs')}</p>
          </div>
        )}
      </div>

      <div className="ps-6 pe-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/80 border-t border-zinc-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
        <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">
          {t('logs.logStorageInfo')}
        </span>
        <button 
          onClick={onClose}
          className="ps-6 pe-6 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl text-sm font-bold hover:opacity-90 transition-all shadow-sm focus-visible:ring-2 focus-visible:ring-blue-500 outline-none"
        >
          {t('common.done')}
        </button>
      </div>
    </ModalLayout>
  );
};

export default LogViewer;