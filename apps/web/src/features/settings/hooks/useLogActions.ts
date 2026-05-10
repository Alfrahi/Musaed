'use client';

import { useState, useCallback } from 'react';
import { useTranslation } from '../../../lib/i18n';
import { useLanguage } from '../../../store/hooks';
import { checkIsTauri, logApi, store, dialog } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';
import toast from 'react-hot-toast';

/**
 * Hook for managing system logs fetch and deletion actions.
 */
export function useLogActions() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const language = useLanguage();
  const { t } = useTranslation(language);
  const isTauri = checkIsTauri();

  /**
   * Fetches the persisted logs from the local store.
   */
  const fetchLogs = useCallback(async () => {
    if (!isTauri) return;
    setIsLoading(true);
    try {
      const logStore = await store.load('logs.json', { autoSave: true });
      if (logStore) {
        const result = (await logStore.get<string[]>('entries')) || [];
        setLogs(result);
      }
    } catch (err) {
      logger.error('Failed to fetch logs', { error: err });
      toast.error(t('error.genericError'));
    } finally {
      setIsLoading(false);
    }
  }, [isTauri, t]);

  /**
   * Clears both the local log store and the backend log buffer.
   */
  const clearLogs = useCallback(async () => {
    if (!isTauri) return;

    const confirmed = await dialog.ask(t('logs.confirmClear'), {
      title: t('logs.clearLogs'),
      kind: 'warning',
    });

    if (confirmed) {
      try {
        const logStore = await store.load('logs.json', { autoSave: true });
        if (logStore) {
          await logStore.set('entries', []);
          await logStore.save();
          setLogs([]);
          await logApi.clear();
          logger.info('System logs cleared');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Failed to clear logs', { error: message });
        toast.error(t('error.genericError'));
      }
    }
  }, [isTauri, t]);

  return {
    logs,
    isLoading,
    fetchLogs,
    clearLogs,
  };
}
