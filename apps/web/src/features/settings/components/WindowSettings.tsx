'use client';

import { Minimize2 } from 'lucide-react';
import { useGlobalSettings, useLanguage } from '@/store/settings-store';
import { useSettingsActions } from '@/features/settings/hooks/useSettingsActions';
import { useTranslation } from '@/lib/i18n';
import { Toggle } from '@/components/ui/toggle';

/**
 * Window behavior settings — currently only the "close to tray" toggle.
 *
 * When enabled (default), closing the main window minimizes it to the
 * system tray instead of quitting the app. The tray menu's "Quit" item
 * is the only exit path. When disabled, the close button exits normally
 * unless a background task (chat stream / model pull / RAG index) is
 * active — in which case the window still minimizes to tray to protect
 * the in-flight work.
 */
const WindowSettings = () => {
  const globalSettings = useGlobalSettings();
  const language = useLanguage();
  const { updateGlobalSettings } = useSettingsActions();
  const { t } = useTranslation(language);

  return (
    <div className="flex flex-col gap-4">
      <div className="text-body flex items-center gap-2 font-medium">
        <Minimize2 size={14} className="text-zinc-400" />
        <span>{t('settings.closeToTray')}</span>
      </div>

      <div className="rounded-md border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <Toggle
          checked={globalSettings.closeToTray}
          onChange={(next) => updateGlobalSettings({ closeToTray: next })}
          label={t('settings.closeToTray')}
          description={t('settings.closeToTrayDescription')}
        />
      </div>
    </div>
  );
};

export default WindowSettings;
