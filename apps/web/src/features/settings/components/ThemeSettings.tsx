"use client";

import { Sun, Moon, Monitor } from 'lucide-react';
import { useSettingsStore } from '../../../store';
import { useSettingsActions } from '../hooks/useSettingsActions';
import { useTranslation } from '../../../lib/i18n';
import { Theme } from '@musaed/contracts';
import { cn } from '../../../lib/utils';

const ThemeSettings = () => {
  const { globalSettings } = useSettingsStore();
  const { updateGlobalSettings } = useSettingsActions();
  const { t } = useTranslation(globalSettings.language);

  const themes: { id: Theme; icon: any }[] = [
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
      <div className="flex p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl w-full">
        {themes.map(({ id, icon: Icon }) => (
          <button 
            key={id}
            onClick={() => updateGlobalSettings({ theme: id })}
            className={cn(
              "flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2",
              globalSettings.theme === id 
                ? "bg-white dark:bg-zinc-700 text-blue-600 shadow-sm" 
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
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