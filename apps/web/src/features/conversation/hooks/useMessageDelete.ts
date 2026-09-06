'use client';

import { useCallback } from 'react';
import { dialogApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';

/**
 * Delete handler with native confirmation dialog. Shows a blocking
 * `dialogApi.ask` (rfd OkCancel) before calling the parent's
 * `onDeleteMessage` callback.
 */
export function useMessageDelete(
  msgId: string,
  onDeleteMessage: ((msgId: string) => void) | undefined,
  t: (key: string) => string
) {
  return useCallback(async () => {
    if (!onDeleteMessage) return;
    const confirmed = await dialogApi.ask(
      t('chat.deleteMessage'),
      t('chat.confirmDeleteMessage'),
      'warning'
    );
    if (confirmed) {
      logger.info('Deleting message', { msgId });
      onDeleteMessage(msgId);
    }
  }, [msgId, onDeleteMessage, t]);
}
