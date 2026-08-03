'use client';

import { useEffect, useId } from 'react';
import { X, Terminal, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/store/settings-store';
import { useTranslation } from '@/lib/i18n';
import { useLogActions } from '@/features/settings/hooks/useLogActions';
import { useIpcViolations } from '@/features/settings/hooks/useIpcViolations';
import { ModalLayout } from '@/components/ui';
import { Button } from '@/components/ui/button';

interface ParsedLog {
  level: 'error' | 'warn' | 'info' | 'debug';
  timestamp: string;
  message: string;
  context?: Record<string, unknown> | unknown[] | string | number | boolean | null;
}

interface LogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

// Standalone log rendering functions
const renderParsedLog = (
  parsed: ParsedLog,
  formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) => string
) => {
  const levelClasses =
    parsed.level === 'error'
      ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-400/10'
      : parsed.level === 'warn'
        ? 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-400/10'
        : 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-400/10';

  return (
    <div
      className="caption-xs flex gap-3 border-b border-zinc-100 py-3 ps-6 pe-6 font-mono dark:border-zinc-800/50"
      role="listitem"
    >
      <span className="shrink-0 text-zinc-400 dark:text-zinc-600">
        [
        {formatDate(new Date(parsed.timestamp), {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
        ]
      </span>
      <span
        className={cn(
          'caption-xs mbs-0.5 h-fit shrink-0 rounded px-1.5 font-bold uppercase',
          levelClasses
        )}
      >
        {parsed.level}
      </span>
      <div className="min-w-0 flex-1">
        <span className="break-words text-zinc-700 dark:text-zinc-300">{parsed.message}</span>
        {parsed.context !== undefined && parsed.context !== null && (
          <pre
            className="caption-xs mbs-1.5 overflow-x-auto rounded-lg border border-zinc-100 bg-zinc-50 p-2 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400"
            tabIndex={0}
          >
            {JSON.stringify(parsed.context, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};

const renderRawLog = (log: string) => (
  <div
    className="caption-xs border-b border-zinc-100 py-3 ps-6 pe-6 font-mono text-zinc-500 dark:border-zinc-800/50"
    role="listitem"
  >
    {log}
  </div>
);

const renderLogRow = (
  log: string,
  formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) => string
) => {
  try {
    const parsed = JSON.parse(log);
    return renderParsedLog(parsed, formatDate);
  } catch {
    return renderRawLog(log);
  }
};

interface LogViewerHeaderProps {
  t: (key: string) => string;
  titleId: string;
  isLoading: boolean;
  fetchLogs: () => void;
  clearLogs: () => void;
  onClose: () => void;
}

const LogViewerHeader = ({
  t,
  titleId,
  isLoading,
  fetchLogs,
  clearLogs,
  onClose,
}: LogViewerHeaderProps) => (
  <div className="pbs-6 pbe-6 flex shrink-0 items-center justify-between border-b border-zinc-100 ps-6 pe-6 dark:border-zinc-800">
    <div className="flex items-center gap-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
        <Terminal size={18} aria-hidden="true" />
      </div>
      <div>
        <h2 id={titleId} className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
          {t('logs.title')}
        </h2>
        <p className="caption-md font-medium text-zinc-500">{t('logs.debuggingHub')}</p>
      </div>
    </div>
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={fetchLogs}
        className="rounded-xl text-zinc-500 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800"
        title={t('logs.refreshLogs')}
      >
        <RefreshCw
          size={18}
          className={cn(isLoading && 'animate-spin text-blue-500')}
          aria-hidden="true"
        />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={clearLogs}
        className="rounded-xl text-zinc-500 hover:bg-zinc-100 hover:text-red-500 focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-zinc-800"
        title={t('logs.clearLogs')}
      >
        <Trash2 size={18} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="rounded-xl text-zinc-500 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800"
        aria-label={t('a11y.closeModal')}
      >
        <X size={20} aria-hidden="true" />
      </Button>
    </div>
  </div>
);

interface LogViewerFooterProps {
  t: (key: string) => string;
  onClose: () => void;
}

const LogViewerFooter = ({ t, onClose }: LogViewerFooterProps) => (
  <div className="flex shrink-0 items-center justify-between border-t border-zinc-100 bg-zinc-50/50 py-4 ps-6 pe-6 dark:border-zinc-800 dark:bg-zinc-900/80">
    <span className="caption-md font-medium text-zinc-400">{t('logs.logStorageInfo')}</span>
    <Button
      variant="secondary"
      onClick={onClose}
      className="text-body shadow-native rounded-xl py-2 ps-6 pe-6 font-bold tracking-normal focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {t('common.done')}
    </Button>
  </div>
);

interface LogViewerContentProps {
  logs: string[];
  t: (key: string) => string;
  formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) => string;
}

const LogViewerContent = ({ logs, t, formatDate }: LogViewerContentProps) => (
  <div className="flex-1 overflow-hidden bg-white dark:bg-zinc-950/50" role="list">
    {logs.length > 0 ? (
      <Virtuoso
        className="h-full"
        data={logs}
        itemContent={(index, log) => renderLogRow(log, formatDate)}
        initialTopMostItemIndex={logs.length > 0 ? logs.length - 1 : 0}
        followOutput="smooth"
      />
    ) : (
      <div className="flex h-full flex-col items-center justify-center space-y-4 text-zinc-400 dark:text-zinc-600">
        <Terminal size={48} className="opacity-10" aria-hidden="true" />
        <p className="text-body font-medium italic">{t('logs.noLogs')}</p>
      </div>
    )}
  </div>
);

interface IpcViolationsListProps {
  t: (key: string, vars?: Record<string, string | number | boolean>) => string;
  formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) => string;
}

/**
 * Surfaces IPC latency-budget violations dispatched to the trace pipeline.
 * Each row renders the inline budget tag `[IPC +{latency} / {budget}ms]`
 * so the reader can correlate the entry with `IpcLatencyPanel` counters
 * and the underlying trace record persisted via `traceApi.append`.
 *
 * Visibility is driven by the polling-free `useIpcViolations` subscription,
 * so this panel only re-renders when a new violation is emitted.
 */
const IpcViolationsList = ({ t, formatDate }: IpcViolationsListProps) => {
  const { violations } = useIpcViolations();

  if (violations.length === 0) return null;

  return (
    <section
      className="shrink-0 border-b border-zinc-100 dark:border-zinc-800"
      aria-label={t('logs.ipcViolations.title')}
    >
      <div className="flex items-center gap-2 bg-yellow-50/60 px-6 py-2 dark:bg-yellow-400/5">
        <AlertTriangle
          size={14}
          className="text-yellow-600 dark:text-yellow-400"
          aria-hidden="true"
        />
        <span className="caption-md font-bold tracking-widest text-yellow-700 uppercase dark:text-yellow-300">
          {t('logs.ipcViolations.title')}
        </span>
      </div>
      <ul role="list" className="max-h-32 overflow-y-auto">
        {violations.map((entry) => {
          const budgetTag = t('logs.ipcViolations.budgetTag', {
            latency: entry.latencyMs,
            budget: entry.budgetMs,
          });
          const overageTooltip = t('logs.ipcViolations.overageTooltip', {
            pct: entry.overagePct,
          });
          return (
            <li
              key={entry.traceId}
              role="listitem"
              className="caption-xs flex gap-3 border-b border-zinc-50 py-2 ps-6 pe-6 font-mono last:border-b-0 dark:border-zinc-800/50"
            >
              <span className="shrink-0 text-zinc-400 dark:text-zinc-600">
                [
                {formatDate(new Date(entry.timestamp), {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
                ]
              </span>
              <span className="caption-xs mbs-0.5 h-fit shrink-0 rounded bg-yellow-100 px-1.5 font-bold text-yellow-700 uppercase dark:bg-yellow-400/10 dark:text-yellow-300">
                {budgetTag}
              </span>
              <div className="min-w-0 flex-1">
                <span
                  className="break-words text-zinc-700 dark:text-zinc-300"
                  title={overageTooltip}
                >
                  {entry.command}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

const LogViewer = ({ isOpen, onClose }: LogViewerProps) => {
  const language = useLanguage();
  const { t, formatDate } = useTranslation(language);
  const titleId = useId();
  const { logs, isLoading, fetchLogs, clearLogs } = useLogActions();

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, fetchLogs]);

  return (
    <ModalLayout
      isOpen={isOpen}
      onClose={onClose}
      titleId={titleId}
      maxWidth="max-w-4xl"
      className="h-[80vh]"
      zIndex="z-[70]"
    >
      <LogViewerHeader
        t={t}
        titleId={titleId}
        isLoading={isLoading}
        fetchLogs={fetchLogs}
        clearLogs={clearLogs}
        onClose={onClose}
      />
      <IpcViolationsList t={t} formatDate={formatDate} />
      <LogViewerContent logs={logs} t={t} formatDate={formatDate} />
      <LogViewerFooter t={t} onClose={onClose} />
    </ModalLayout>
  );
};

export default LogViewer;
