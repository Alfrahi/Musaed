'use client';

import { useState, useCallback } from 'react';
import { useTranslation } from '@/lib/i18n';
import { useLanguage } from '@/store/settings-store';
import { checkIsTauri, logApi, storeApi, dialogApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';
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
      await storeApi.load('logs.json');
      const result = await storeApi.get('logs.json', 'entries');
      if (result && Array.isArray(result)) {
        setLogs(result as string[]);
      } else {
        setLogs([]);
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

    const confirmed = await dialogApi.ask(t('logs.clearLogs'), t('logs.confirmClear'), 'warning');

    if (confirmed) {
      try {
        await storeApi.load('logs.json');
        await storeApi.set('logs.json', 'entries', []);
        await storeApi.save('logs.json');
        setLogs([]);
        await logApi.clear();
        logger.info('System logs cleared');
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
