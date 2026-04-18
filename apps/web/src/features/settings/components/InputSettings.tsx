"use client";

import { Keyboard } from 'lucide-react';
import { useSettingsStore } from '../../../store';
import { useSettingsActions } from '../hooks/useSettingsActions';
import { useTranslation } from '../../../lib/i18n';

const InputSettings = () => {
  const { globalSettings } = useSettingsStore();
  const { updateGlobalSettings } = useSettingsActions();
  const { t } = useTranslation(globalSettings.language);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Keyboard size={14} className="text-zinc-400" />
        <label>{t('settings.enterToSend')}</label>
      </div>
      
      <div className="flex items-start gap-4 p-4 bg-zinc-50 dark:bg-zinc-800 rounded-xl border border-zinc-100 dark:border-zinc-700">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            {t('settings.enterToSendDescription')}
          </p>
        </div>
        
        <button
          onClick={() => updateGlobalSettings({ enterToSend: !globalSettings.enterToSend })}
          className={`shrink-0 w-10 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500/20 ltr ${
            globalSettings.enterToSend ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'
          }`}
          role="switch"
          aria-checked={globalSettings.enterToSend}
          dir="ltr"
        >
          <div
            className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${
              globalSettings.enterToSend ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );
};

export default InputSettings;