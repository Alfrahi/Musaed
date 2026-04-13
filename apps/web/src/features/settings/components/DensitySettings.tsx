"use client";

import { Maximize2 } from 'lucide-react';
import { useSettingsStore } from '../../../store';
import { useSettingsActions } from '../hooks/useSettingsActions';
import { useTranslation } from '../../../lib/i18n';

const DensitySettings = () => {
  const { globalSettings } = useSettingsStore();
  const { updateGlobalSettings } = useSettingsActions();
  const { t, formatNumber } = useTranslation(globalSettings.language);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm font-medium">
        <div className="flex items-center gap-2">
          <Maximize2 size={14} className="text-zinc-400" />
          <label>{t('settings.appearance')}</label>
        </div>
        <span className="text-xs font-mono text-zinc-500">
          {formatNumber(globalSettings.density, { minimumFractionDigits: 1 })}
        </span>
      </div>
      <input 
        type="range" 
        min="0.8" 
        max="1.2" 
        step="0.05" 
        value={globalSettings.density}
        onChange={(e) => updateGlobalSettings({ density: parseFloat(e.target.value) })}
        className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
      />
    </div>
  );
};

export default DensitySettings;