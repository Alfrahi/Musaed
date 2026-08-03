'use client';

import { Minimize2 } from 'lucide-react';
import { useGlobalSettings, useLanguage } from '@/store/settings-store';
import { useSettingsActions } from '@/features/settings/hooks/useSettingsActions';
import { useTranslation } from '@/lib/i18n';

/**
 * Window behavior settings — currently only the "close to tray" toggle.
 *
 * When enabled (default), closing the main window minimizes it to the
 * system tray instead of quitting the app. The tray menu's "Quit" item
 * is the only exit path. When disabled, the close button exits normally
 * unless a background task (chat stream / model pull / RAG index) is
 * active — in which case the window still minimizes to tray to protect
 * the in-flight work (audit S-1 fallback).
 */
const WindowSettings = () => {
  const globalSettings = useGlobalSettings();
  const language = useLanguage();
  const { updateGlobalSettings } = useSettingsActions();
  const { t } = useTranslation(language);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-body flex items-center gap-2 font-medium">
        <Minimize2 size={14} className="text-zinc-400" />
        <label>{t('settings.closeToTray')}</label>
      </div>

      <div className="flex items-start gap-4 rounded-md border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="min-w-0 flex-1">
          <p className="text-caption leading-relaxed text-zinc-500 dark:text-zinc-400">
            {t('settings.closeToTrayDescription')}
          </p>
        </div>

        {/* eslint-disable-next-line musaed-buttons/prefer-button-primitive -- role="switch" toggle, not an action button */}
        <button
          onClick={() => updateGlobalSettings({ closeToTray: !globalSettings.closeToTray })}
          className={`focus-ring duration-normal h-6 w-10 shrink-0 rounded-full p-1 transition-colors ease-in-out ${
            globalSettings.closeToTray ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'
          }`}
          role="switch"
          aria-checked={globalSettings.closeToTray}
        >
          <div
            className={`shadow-native duration-normal h-4 w-4 transform rounded-full bg-white transition-transform ease-in-out ${
              globalSettings.closeToTray ? 'ltr:translate-x-4 rtl:-translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );
};

export default WindowSettings;
