"use client";

import { useState } from 'react';
import { Search, ExternalLink, RefreshCw, X, HardDrive, Plus, Terminal } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useTranslation } from '../../../lib/i18n';
import { Language } from '@musaed/contracts';
import { opener } from '../../../lib/ipc';

interface LibrarySearchHeaderProps {
  language: Language;
  activeTab: 'featured' | 'installed';
  setActiveTab: (tab: 'featured' | 'installed') => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isRefreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
  installedCount: number;
  onPullAny: (name: string) => void;
}

const LibrarySearchHeader = ({
  language,
  activeTab,
  setActiveTab,
  searchQuery,
  setSearchQuery,
  isRefreshing,
  onRefresh,
  onClose,
  installedCount,
  onPullAny
}: LibrarySearchHeaderProps) => {
  const { t } = useTranslation(language);
  const [customModel, setCustomModel] = useState('');

  const handleCustomPull = (e: React.FormEvent) => {
    e.preventDefault();
    if (customModel.trim()) {
      onPullAny(customModel.trim());
      setCustomModel('');
    }
  };

  return (
    <>
      <div className="flex items-center justify-between pbs-6 pbe-6 ps-6 pe-6 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
            <HardDrive size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">{t('library.modelManager')}</h2>
            <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">{t('library.localIntelligence')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={onRefresh}
            className={cn(
              "p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all text-zinc-500",
              isRefreshing && "animate-spin text-blue-500"
            )}
            title={t('library.refreshModels')}
          >
            <RefreshCw size={20} />
          </button>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all">
            <X size={24} />
          </button>
        </div>
      </div>

      <div className="ps-6 pe-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex p-1 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-lg w-fit">
            <button 
              onClick={() => setActiveTab('featured')}
              className={cn(
                "px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-widest transition-all",
                activeTab === 'featured' ? "bg-white dark:bg-zinc-700 text-blue-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              {t('library.title')}
            </button>
            <button 
              onClick={() => setActiveTab('installed')}
              className={cn(
                "px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-widest transition-all",
                activeTab === 'installed' ? "bg-white dark:bg-zinc-700 text-blue-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              {t('library.installed', { count: installedCount })}
            </button>
          </div>

          <form onSubmit={handleCustomPull} className="flex-1 min-w-[200px] flex items-center gap-2">
            <div className="relative flex-1">
              <Terminal size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input 
                type="text"
                placeholder={t('library.pullFromOllama', { name: 'llama3:8b' })}
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg py-2 ps-9 pe-3 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
              />
            </div>
            <button 
              type="submit"
              disabled={!customModel.trim()}
              className="p-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg disabled:opacity-50 transition-all active:scale-95"
              title={t('library.pullModel')}
            >
              <Plus size={18} />
            </button>
          </form>

          <div className="hidden lg:flex items-center gap-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
            <button 
              onClick={() => opener.openUrl('https://ollama.com/library')} 
              className="flex items-center gap-1 hover:text-blue-500 transition-colors"
            >
              {t('library.ollamaLibrary')} <ExternalLink size={12} className="mirror-rtl" />
            </button>
          </div>
        </div>
        
        <div className="relative w-full">
          <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input 
            type="text"
            placeholder={activeTab === 'featured' ? t('library.searchLibrary') : t('library.searchInstalled')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg py-2.5 ps-10 pe-4 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>
      </div>
    </>
  );
};

export default LibrarySearchHeader;