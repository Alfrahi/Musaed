'use client';

import { useMemo } from 'react';
import { Gauge, RefreshCw, X } from 'lucide-react';
import { IPC_LATENCY_BUDGETS, getIpcLatencyBudgetCategory } from '@musaed/contracts';
import { useIpcLatencyStats } from '@/features/settings/hooks/useIpcLatency';
import { useLanguage } from '@/store/settings-store';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type Row = {
  command: string;
  latencyMs: number;
  budgetMs: number;
  status: 'ok' | 'violation';
  category: string;
};

const LatencyRow = ({
  row,
  t,
}: {
  row: Row;
  t: (key: string, vars?: Record<string, string | number | boolean>) => string;
}) => {
  const isViolation = row.status === 'violation';
  return (
    <li className="caption-xs flex items-center justify-between gap-2 py-2" role="listitem">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-zinc-700 dark:text-zinc-200">{row.command}</span>
        <span className="caption-xs tracking-widest text-zinc-400 uppercase">
          {t('settings.ipcLatency.category', { category: row.category })}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3 font-mono">
        <span
          className={cn(
            'shrink-0',
            isViolation ? 'text-red-600 dark:text-red-400' : 'text-zinc-500'
          )}
          title={
            isViolation
              ? t('settings.ipcLatency.overage', {
                  pct: Math.round(((row.latencyMs - row.budgetMs) / row.budgetMs) * 100),
                })
              : undefined
          }
        >
          {t('settings.ipcLatency.latencyMs', { ms: row.latencyMs })}
        </span>
        <span className="text-zinc-400">/ {row.budgetMs} ms</span>
        <X
          size={11}
          className={cn(
            'shrink-0',
            isViolation ? 'rotate-45 text-red-500 opacity-100' : 'text-green-500 opacity-30'
          )}
          aria-hidden="true"
        />
      </div>
    </li>
  );
};

/**
 * Compact diagnostics panel that surfaces the current IPC latency-budget
 * counters — call count, violation count, and a per-command breakdown that
 * uses the budgets defined in `@musaed/contracts` (`IPC_LATENCY_BUDGETS`).
 *
 * Polled on a fixed cadence (default 2 s) by `useIpcLatencyStats`.
 */
const IpcLatencyPanel = () => {
  const language = useLanguage();
  const { t } = useTranslation(language);
  const { stats, reset } = useIpcLatencyStats();

  // Pull the most recent call per command for the table view.
  const rowsByCommand = useMemo(() => {
    const map = new Map<string, Row>();
    for (const call of stats.calls) {
      const existing = map.get(call.command);
      if (!existing) {
        map.set(call.command, {
          ...call,
          category: getIpcLatencyBudgetCategory(call.command) ?? '—',
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.latencyMs - a.latencyMs);
  }, [stats.calls]);

  // Pre-compute unique budgets known but never called (so the panel hints at
  // coverage without forcing a call).
  const knownBudgetCount = Object.keys(IPC_LATENCY_BUDGETS).length;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-100 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Gauge size={14} className="text-zinc-400" />
          <label>{t('settings.ipcLatency.title')}</label>
          {stats.violationCount > 0 && (
            <span
              className="caption-xs rounded-full bg-red-50 px-2 py-0.5 font-bold tracking-widest text-red-600 uppercase dark:bg-red-500/10 dark:text-red-400"
              role="status"
              aria-label={t('settings.ipcLatency.violationsBadge', {
                count: stats.violationCount,
              })}
            >
              {t('settings.ipcLatency.violationsBadge', { count: stats.violationCount })}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          className="caption-xs gap-1 font-bold tracking-widest text-blue-600 uppercase hover:text-blue-700"
          title={t('settings.ipcLatency.clear')}
        >
          <RefreshCw size={12} aria-hidden="true" />
          {t('settings.ipcLatency.clear')}
        </Button>
      </div>

      <p className="caption-md font-bold tracking-widest text-zinc-400 uppercase">
        {t('settings.ipcLatency.description')}
      </p>

      <div className="caption-md flex items-center justify-between font-bold tracking-widest text-zinc-500 uppercase">
        <span data-testid="ipc-latency-total">
          {t('settings.ipcLatency.totalCalls', { count: stats.callCount })}
        </span>
        <span data-testid="ipc-latency-violations">
          {t('settings.ipcLatency.violations', { count: stats.violationCount })}
        </span>
        <span data-testid="ipc-latency-budgets">
          {t('settings.ipcLatency.budgetMs', { ms: knownBudgetCount })}
        </span>
      </div>

      {rowsByCommand.length === 0 ? (
        <p className="caption-xs py-4 text-center font-medium text-zinc-400 italic">
          {t('settings.ipcLatency.noViolations')}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800" role="list">
          {rowsByCommand.slice(0, 12).map((row) => (
            <LatencyRow key={row.command} row={row} t={t} />
          ))}
        </ul>
      )}
    </div>
  );
};

export default IpcLatencyPanel;
