"use client";

import { Search, ExternalLink, RefreshCw, X, HardDrive } from 'lucide-react';
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
  installedCount
}: LibrarySearchHeaderProps) => {
  const { t } = useTranslation(language);

  return (
    <>
      <div className="flex items-center justify-between pbs-6 pbe-6 ps-6 pe-6 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
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
              "p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all text-zinc-500",
              isRefreshing && "animate-spin text-blue-500"
            )}
          >
            <RefreshCw size={20} />
          </button>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all">
            <X size={24} />
          </button>
        </div>
      </div>

      <div className="ps-6 pe-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex p-1 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-xl w-fit">
            <button 
              onClick={() => setActiveTab('featured')}
              className={cn(
                "px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all",
                activeTab === 'featured' ? "bg-white dark:bg-zinc-700 text-blue-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              {t('library.title')}
            </button>
            <button 
              onClick={() => setActiveTab('installed')}
              className={cn(
                "px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all",
                activeTab === 'installed' ? "bg-white dark:bg-zinc-700 text-blue-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              {t('library.installed', { count: installedCount })}
            </button>
          </div>
          <div className="hidden sm:flex items-center gap-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
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
            className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl py-2.5 ps-10 pe-4 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>
      </div>
    </>
  );
};

export default LibrarySearchHeader;