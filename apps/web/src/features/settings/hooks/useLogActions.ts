"use client";

import { useState, useCallback } from 'react';
import { useTranslation } from '../../../lib/i18n';
import { useSettingsStore } from '../../../store';
import { checkIsTauri, invoke, store, dialog } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';

export function useLogActions() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const language = useSettingsStore(state => state.globalSettings.language);
  const { t } = useTranslation(language);
  const isTauri = checkIsTauri();

  const fetchLogs = useCallback(async () => {
    if (!isTauri) return;
    setIsLoading(true);
    try {
      const logStore = await store.load('logs.json', { autoSave: true });
      if (logStore) {
        const result = await logStore.get<string[]>('entries') || [];
        setLogs(result);
      }
    } catch (err) {
      logger.error('Failed to fetch logs', { error: err });
    } finally {
      setIsLoading(false);
    }
  }, [isTauri]);

  const clearLogs = useCallback(async () => {
    if (!isTauri) return;
    
    const confirmed = await dialog.ask(t('logs.confirmClear'), {
      title: t('logs.clearLogs'),
      kind: 'warning'
    });

    if (confirmed) {
      try {
        const logStore = await store.load('logs.json', { autoSave: true });
        if (logStore) {
          await logStore.set('entries', []);
          await logStore.save();
          setLogs([]);
          await invoke('clear_logs');
          logger.info('System logs cleared');
        }
      } catch (err) {
        logger.error('Failed to clear logs', { error: err });
      }
    }
  }, [isTauri, t]);

  return {
    logs,
    isLoading,
    fetchLogs,
    clearLogs
  };
}