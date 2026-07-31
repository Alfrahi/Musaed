'use client';

import { useCallback } from 'react';
import { useSettingsStore } from '@/store/settings-store';
import { useSettingsActions } from './useSettingsActions';
import { useStorageCleanup } from './useStorageCleanup';
import { getSystemLanguage, setActiveLanguageResolver } from '@/lib/i18n';

/**
 * Boot-phase initialization for the settings feature.
 *
 * Extracted from the monolithic `useAppInitialization` orchestrator so each
 * feature owns its own init sequence. Called once at app startup.
 */
export function useSettingsInitialization() {
  const { updateGlobalSettings } = useSettingsActions();
  const { runCleanup } = useStorageCleanup();

  const initialize = useCallback(async () => {
    // Wire the i18n language resolver for module-scoped code (lib/ipc.ts toast
    // error paths, etc.). The resolver reads live settings state on each call so
    // it tracks language changes without needing re-registration.
    setActiveLanguageResolver(() => useSettingsStore.getState().globalSettings.language);

    const currentSettings = useSettingsStore.getState().globalSettings;
    if (!currentSettings.hasDetectedLanguage) {
      const sysLang = getSystemLanguage();
      updateGlobalSettings({
        language: sysLang,
        hasDetectedLanguage: true,
      });
    }

    // Execute storage retention policy cleanup
    runCleanup();
  }, [updateGlobalSettings, runCleanup]);

  return { initialize };
}
