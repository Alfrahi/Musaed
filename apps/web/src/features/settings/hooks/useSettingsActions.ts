'use client';

import { useCallback } from 'react';
import { DEFAULT_SETTINGS, ChatSettings } from '@musaed/contracts';
import { useSettingsStore } from '../../../store';
import { useSetGlobalSettings } from '../../../store/hooks';
import { logger } from '../../../lib/logger';

export function useSettingsActions() {
  const setGlobalSettings = useSetGlobalSettings();

  const updateGlobalSettings = useCallback(
    (update: Partial<ChatSettings>) => {
      const currentSettings = useSettingsStore.getState().globalSettings;
      logger.debug('Updating global settings', { update });
      setGlobalSettings({ ...currentSettings, ...update });
    },
    [setGlobalSettings]
  );

  const resetGlobalSettings = useCallback(() => {
    logger.warn('Resetting global settings to default');
    setGlobalSettings(DEFAULT_SETTINGS);
  }, [setGlobalSettings]);

  return {
    updateGlobalSettings,
    resetGlobalSettings,
  };
}
