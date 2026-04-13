"use client";

import { Settings2, RefreshCw } from 'lucide-react';
import { useModelStore, useUIStore, useSettingsStore } from '../../../store';
import { cn } from '../../../lib/utils';
import { useTranslation } from '../../../lib/i18n';
import { useModelActions } from '../hooks/useModelActions';

const ModelSelector = () => {
  const { selectedModel, models, setSelectedModel } = useModelStore();
  const { isStreaming } = useUIStore();
  const { globalSettings } = useSettingsStore();
  const { fetchModels } = useModelActions();
  const { t } = useTranslation(globalSettings.language);

  return (
    <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
      <Settings2 size={14} />
      <div className="flex items-center gap-1">
        <select 
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="bg-transparent border-none focus:ring-0 cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors font-bold outline-none"
        >
          {models.length > 0 ? (
            models.map(m => (
              <option key={m.name} value={m.name} className="bg-white dark:bg-zinc-900">
                {m.name}
              </option>
            ))
          ) : (
            <option value="">{t('library.noModelsFound')}</option>
          )}
        </select>
        <button 
          onClick={() => fetchModels()}
          className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
          title={t('library.refreshModels')}
        >
          <RefreshCw size={12} className={cn(isStreaming && "animate-spin")} />
        </button>
      </div>
    </div>
  );
};

export default ModelSelector;