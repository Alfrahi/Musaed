"use client";

import { Languages } from 'lucide-react';
import { useSettingsStore } from '../../../store';
import { useSettingsActions } from '../hooks/useSettingsActions';
import { useTranslation } from '../../../lib/i18n';

const LanguageSettings = () => {
  const { globalSettings } = useSettingsStore();
  const { updateGlobalSettings } = useSettingsActions();
  const { t } = useTranslation(globalSettings.language);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Languages size={14} className="text-zinc-400" />
        <label>{t('settings.language')}</label>
      </div>
      <div className="flex p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl w-full">
        {['en', 'ar'].map((lang) => (
          <button 
            key={lang}
            onClick={() => updateGlobalSettings({ language: lang as any })}
            className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${globalSettings.language === lang ? 'bg-white dark:bg-zinc-700 text-blue-600 shadow-sm' : 'text-zinc-500'}`}
          >
            {t(`common.${lang}`)}
          </button>
        ))}
      </div>
    </div>
  );
};

export default LanguageSettings;