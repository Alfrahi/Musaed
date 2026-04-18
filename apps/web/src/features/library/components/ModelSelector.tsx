"use client";

import { useState, useRef, useEffect } from 'react';
import { Settings2, RefreshCw, ChevronDown, Check } from 'lucide-react';
import { useModelStore, useUIStore, useSettingsStore } from '../../../store';
import { cn } from '../../../lib/utils';
import { useTranslation } from '../../../lib/i18n';
import { useModelActions } from '../hooks/useModelActions';

const ModelSelector = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { selectedModel, models, setSelectedModel } = useModelStore();
  const { isStreaming } = useUIStore();
  const { globalSettings } = useSettingsStore();
  const { fetchModels } = useModelActions();
  const { t } = useTranslation(globalSettings.language);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (modelName: string) => {
    setSelectedModel(modelName);
    setIsOpen(false);
  };

  return (
    <div className="relative font-sans" ref={dropdownRef}>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-none border border-transparent hover:border-sidebar-border hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-all text-[13px] font-bold uppercase text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 outline-none focus-visible:ring-1 focus-visible:ring-blue-500",
            isOpen && "border-sidebar-border bg-zinc-100 dark:bg-zinc-800/50 text-zinc-900 dark:text-zinc-100"
          )}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <Settings2 size={16} className={cn("transition-transform duration-300", isOpen && "rotate-90")} />
          <span className="truncate max-w-[150px]">
            {selectedModel || t('library.noModelsFound')}
          </span>
          <ChevronDown size={14} className={cn("transition-transform duration-200", isOpen && "rotate-180")} />
        </button>

        <button 
          onClick={() => fetchModels(true)}
          className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-none transition-colors text-zinc-400 hover:text-blue-500"
          title={t('library.refreshModels')}
        >
          <RefreshCw size={14} className={cn(isStreaming && "animate-spin")} />
        </button>
      </div>

      {isOpen && (
        <div 
          className="absolute bottom-full mb-2 start-0 min-w-[240px] bg-white dark:bg-zinc-900 border border-sidebar-border shadow-pro z-50 py-1 animate-in fade-in slide-in-from-bottom-2 duration-200"
          role="listbox"
        >
          <div className="px-4 py-2.5 border-b border-sidebar-border mb-1">
            <span className="text-[11px] font-black text-zinc-400 uppercase">
              {t('a11y.selectModel')}
            </span>
          </div>
          
          <div className="max-h-[300px] overflow-y-auto">
            {models.length > 0 ? (
              models.map((m) => (
                <button
                  key={m.name}
                  onClick={() => handleSelect(m.name)}
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 outline-none focus:bg-zinc-50 dark:focus:bg-zinc-800/50",
                    selectedModel === m.name ? "text-blue-600 dark:text-blue-400" : "text-zinc-600 dark:text-zinc-400"
                  )}
                  role="option"
                  aria-selected={selectedModel === m.name}
                >
                  <span className="truncate">{m.name}</span>
                  {selectedModel === m.name && <Check size={16} className="shrink-0" />}
                </button>
              ))
            ) : (
              <div className="px-4 py-6 text-center">
                <p className="text-xs font-bold text-zinc-400 uppercase italic">
                  {t('library.noModelsFound')}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelSelector;