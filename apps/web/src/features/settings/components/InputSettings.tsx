'use client';

import { Keyboard } from 'lucide-react';
import { useGlobalSettings, useLanguage } from '@/store/settings-store';
import { useSettingsActions } from '@/features/settings/hooks/useSettingsActions';
import { useTranslation } from '@/lib/i18n';

const InputSettings = () => {
  const globalSettings = useGlobalSettings();
  const language = useLanguage();
  const { updateGlobalSettings } = useSettingsActions();
  const { t } = useTranslation(language);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Keyboard size={14} className="text-zinc-400" />
        <label>{t('settings.enterToSend')}</label>
      </div>

      <div className="flex items-start gap-4 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {t('settings.enterToSendDescription')}
          </p>
        </div>

        <button
          onClick={() => updateGlobalSettings({ enterToSend: !globalSettings.enterToSend })}
          className={`ltr focus-visible:ring-offset-background h-6 w-10 shrink-0 rounded-full p-1 transition-colors duration-200 ease-in-out focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none ${
            globalSettings.enterToSend ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'
          }`}
          role="switch"
          aria-checked={globalSettings.enterToSend}
          dir="ltr"
        >
          <div
            className={`h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
              globalSettings.enterToSend ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );
};

export default InputSettings;
