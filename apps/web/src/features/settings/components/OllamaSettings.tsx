"use client";

import { Globe, Terminal } from 'lucide-react';
import { useSettingsStore } from '@/store';
import { useSettingsActions } from '../hooks/useSettingsActions';
import { useModelActions } from '@/features/library';
import { useTranslation } from '@/lib/i18n';

const OllamaSettings = () => {
  const { globalSettings } = useSettingsStore();
  const { updateGlobalSettings } = useSettingsActions();
  const { fetchModels } = useModelActions();
  const { t } = useTranslation(globalSettings.language);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Globe size={14} className="text-zinc-400" />
          <label>{t('settings.ollamaUrl')}</label>
        </div>
        <input 
          type="text" 
          value={globalSettings.ollamaUrl} 
          onChange={(e) => updateGlobalSettings({ ollamaUrl: e.target.value })}
          onBlur={() => fetchModels()}
          className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl ps-3 pe-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Terminal size={14} className="text-zinc-400" />
          <label>{t('settings.systemPrompt')}</label>
        </div>
        <textarea 
          value={globalSettings.systemPrompt}
          onChange={(e) => updateGlobalSettings({ systemPrompt: e.target.value })}
          className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-xs min-h-[100px] outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
        />
      </div>
    </div>
  );
};

export default OllamaSettings;