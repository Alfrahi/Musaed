'use client';

import { Sun, Moon, Monitor, type LucideIcon } from 'lucide-react';
import { useGlobalSettings, useLanguage } from '@/store/settings-store';
import { useSettingsActions } from '@/features/settings/hooks/useSettingsActions';
import { useTranslation } from '@/lib/i18n';
import { type Theme } from '@musaed/contracts';
import { cn } from '@/lib/utils';

const ThemeSettings = () => {
  const globalSettings = useGlobalSettings();
  const language = useLanguage();
  const { updateGlobalSettings } = useSettingsActions();
  const { t } = useTranslation(language);

  const themes: { id: Theme; icon: LucideIcon }[] = [
    { id: 'light', icon: Sun },
    { id: 'dark', icon: Moon },
    { id: 'system', icon: Monitor },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Monitor size={14} className="text-zinc-400" />
        <label>{t('settings.appearance')}</label>
      </div>
      <div className="flex w-full rounded-none bg-zinc-100 p-1 dark:bg-zinc-800">
        {themes.map(({ id, icon: Icon }) => (
          <button
            key={id}
            onClick={() => updateGlobalSettings({ theme: id })}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-none py-2 text-xs font-bold tracking-widest uppercase transition-all',
              globalSettings.theme === id
                ? 'bg-white text-blue-600 shadow-sm dark:bg-zinc-700'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            )}
          >
            <Icon size={14} />
            {t(`settings.themes.${id}`)}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ThemeSettings;
