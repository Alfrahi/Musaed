"use client";

import { useSettingsStore } from '../../../store';
import { useSettingsActions } from '../hooks/useSettingsActions';
import { useTranslation } from '../../../lib/i18n';

const ModelParamsSettings = () => {
  const { globalSettings } = useSettingsStore();
  const { updateGlobalSettings } = useSettingsActions();
  const { t, formatNumber } = useTranslation(globalSettings.language);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">{t('settings.temperature')}</label>
          <span className="text-xs font-mono text-zinc-500">
            {formatNumber(globalSettings.temperature, { minimumFractionDigits: 1 })}
          </span>
        </div>
        <input 
          type="range" 
          min="0" 
          max="1" 
          step="0.1" 
          value={globalSettings.temperature}
          onChange={(e) => updateGlobalSettings({ temperature: parseFloat(e.target.value) })}
          className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-zinc-500">{t('settings.topP')}</label>
            <span className="text-[10px] font-mono text-zinc-400">
              {formatNumber(globalSettings.top_p, { minimumFractionDigits: 1 })}
            </span>
          </div>
          <input 
            type="range" 
            min="0" 
            max="1" 
            step="0.1" 
            value={globalSettings.top_p}
            onChange={(e) => updateGlobalSettings({ top_p: parseFloat(e.target.value) })}
            className="w-full h-1 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-zinc-500">{t('settings.topK')}</label>
            <span className="text-[10px] font-mono text-zinc-400">
              {formatNumber(globalSettings.top_k)}
            </span>
          </div>
          <input 
            type="range" 
            min="0" 
            max="100" 
            step="1" 
            value={globalSettings.top_k}
            onChange={(e) => updateGlobalSettings({ top_k: parseInt(e.target.value) })}
            className="w-full h-1 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 pbs-1">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-zinc-500 block">{t('settings.contextWindow')}</label>
          <input 
            type="number" 
            value={globalSettings.num_ctx}
            onChange={(e) => updateGlobalSettings({ num_ctx: parseInt(e.target.value) || 2048 })}
            className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 text-[11px] font-mono outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-zinc-500 block">{t('settings.maxTokens')}</label>
          <input 
            type="number" 
            value={globalSettings.num_predict}
            onChange={(e) => updateGlobalSettings({ num_predict: parseInt(e.target.value) || 2048 })}
            className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 text-[11px] font-mono outline-none focus:border-blue-500 transition-colors"
          />
        </div>
      </div>
    </div>
  );
};

export default ModelParamsSettings;