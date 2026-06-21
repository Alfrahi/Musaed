'use client';

import { useCallback } from 'react';
import { DEFAULT_SETTINGS, type ChatSettings } from '@musaed/contracts';
import { useSettingsStore, useSetGlobalSettings } from '../store/settings-store';
import { logger } from '../../../lib/logger';

/**
 * Provides actions for managing global application settings.
 * - `updateGlobalSettings`: merges partial updates into the current settings
 * - `resetGlobalSettings`: restores factory defaults
 *
 * The hook uses `useSettingsStore.getState()` to read the current settings
 * and logs changes for diagnostics.
 */
export function useSettingsActions() {
  const setGlobalSettings = useSetGlobalSettings();

  /**
   * Merges a partial update into the current global settings.
   * Logs a debug message with the update payload.
   * @param update - Partial settings object to merge
   */
  const updateGlobalSettings = useCallback(
    (update: Partial<ChatSettings>) => {
      const currentSettings = useSettingsStore.getState().globalSettings;
      logger.debug('Updating global settings', { update });
      setGlobalSettings({ ...currentSettings, ...update });
    },
    [setGlobalSettings]
  );

  /**
   * Resets all global settings to their default values.
   * Logs a warning for audit purposes.
   */
  const resetGlobalSettings = useCallback(() => {
    logger.warn('Resetting global settings to default');
    setGlobalSettings(DEFAULT_SETTINGS);
  }, [setGlobalSettings]);

  return {
    updateGlobalSettings,
    resetGlobalSettings,
  };
}
