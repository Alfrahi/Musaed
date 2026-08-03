'use client';

import { Languages } from 'lucide-react';
import { useGlobalSettings, useLanguage } from '@/store/settings-store';
import { useSettingsActions } from '@/features/settings/hooks/useSettingsActions';
import { useTranslation } from '@/lib/i18n';
import { type Language } from '@musaed/contracts';

const LanguageSettings = () => {
  const globalSettings = useGlobalSettings();
  const language = useLanguage();
  const { updateGlobalSettings } = useSettingsActions();
  const { t } = useTranslation(language);

  const availableLanguages: Language[] = ['en', 'ar'];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Languages size={14} className="text-zinc-400" />
        <label>{t('settings.language')}</label>
      </div>
      <div className="flex w-full rounded-md bg-zinc-100 p-1 dark:bg-zinc-800">
        {availableLanguages.map((lang) => (
          // eslint-disable-next-line musaed-buttons/prefer-button-primitive -- segmented control toggle, not an action button
          <button
            key={lang}
            onClick={() => updateGlobalSettings({ language: lang })}
            className={`flex-1 rounded-md py-2 text-xs font-bold tracking-widest uppercase transition-all ${globalSettings.language === lang ? 'bg-white text-blue-600 shadow-sm dark:bg-zinc-700' : 'text-zinc-500'}`}
          >
            {t(`common.${lang}` as const)}
          </button>
        ))}
      </div>
    </div>
  );
};

export default LanguageSettings;
