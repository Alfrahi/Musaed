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

/** Top bar with brand title and control buttons. */
const HeaderBar = ({
  title, subtitle, onRefresh, isRefreshing, onClose, refreshTitle,
}: {
  title: string; subtitle: string; onRefresh: () => void;
  isRefreshing: boolean; onClose: () => void; refreshTitle: string;
}) => (
  <div className="flex items-center justify-between pbs-6 pbe-6 ps-6 pe-6 border-b border-zinc-100 dark:border-zinc-800">
    <div className="flex items-center gap-4">
      <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
        <HardDrive size={20} />
      </div>
      <div>
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">{subtitle}</p>
      </div>
    </div>
    <div className="flex items-center gap-2">
      <button onClick={onRefresh} className={cn("p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all text-zinc-500", isRefreshing && "animate-spin text-blue-500")} title={refreshTitle}>
        <RefreshCw size={20} />
      </button>
      <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all">
        <X size={24} />
      </button>
    </div>
  </div>
);

/** Tab buttons for Featured / Installed. */
const TabBar = ({
  activeTab, setActiveTab, featuredLabel, installedLabel,
}: {
  activeTab: 'featured' | 'installed'; setActiveTab: (t: 'featured' | 'installed') => void;
  featuredLabel: string; installedLabel: string;
}) => (
  <div className="flex p-1 bg-zinc-200/50 dark:bg-zinc-800/50 rounded-lg w-fit">
    {(['featured', 'installed'] as const).map(tab => (
      <button
        key={tab}
        onClick={() => setActiveTab(tab)}
        className={cn(
          "px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-widest transition-all",
          activeTab === tab ? "bg-white dark:bg-zinc-700 text-blue-600 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
        )}
      >
        {tab === 'featured' ? featuredLabel : installedLabel}
      </button>
    ))}
  </div>
);

/** Custom model pull input with terminal icon. */
const CustomPullForm = ({
  onPullAny, placeholder, buttonTitle,
}: {
  onPullAny: (name: string) => void; placeholder: string; buttonTitle: string;
}) => {
  const [customModel, setCustomModel] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customModel.trim()) { onPullAny(customModel.trim()); setCustomModel(''); }
  };

  return (
    <form onSubmit={handleSubmit} className="flex-1 min-w-[200px] flex items-center gap-2">
      <div className="relative flex-1">
        <Terminal size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          type="text" placeholder={placeholder} value={customModel}
          onChange={(e) => setCustomModel(e.target.value)}
          className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg py-2 ps-9 pe-3 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
        />
      </div>
      <button type="submit" disabled={!customModel.trim()} className="p-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg disabled:opacity-50 transition-all active:scale-95" title={buttonTitle}>
        <Plus size={18} />
      </button>
    </form>
  );
};

/** Search input for filtering models. */
const SearchBar = ({
  value, onChange, placeholder,
}: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) => (
  <div className="relative w-full">
    <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
    <input
      type="text" placeholder={placeholder} value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg py-2.5 ps-10 pe-4 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
    />
  </div>
);

const LibrarySearchHeader = ({
  language, activeTab, setActiveTab, searchQuery, setSearchQuery,
  isRefreshing, onRefresh, onClose, installedCount, onPullAny,
}: LibrarySearchHeaderProps) => {
  const { t } = useTranslation(language);

  return (
    <>
      <HeaderBar
        title={t('library.modelManager')} subtitle={t('library.localIntelligence')}
        onRefresh={onRefresh} isRefreshing={isRefreshing} onClose={onClose} refreshTitle={t('library.refreshModels')}
      />
      <div className="ps-6 pe-6 py-4 bg-zinc-50/50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <TabBar activeTab={activeTab} setActiveTab={setActiveTab} featuredLabel={t('library.title')} installedLabel={t('library.installed', { count: installedCount })} />
          <CustomPullForm onPullAny={onPullAny} placeholder={t('library.pullFromOllama', { name: 'llama3:8b' })} buttonTitle={t('library.pullModel')} />
          <div className="hidden lg:flex items-center gap-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
            <button onClick={() => opener.openUrl('https://ollama.com/library')} className="flex items-center gap-1 hover:text-blue-500 transition-colors">
              {t('library.ollamaLibrary')} <ExternalLink size={12} className="mirror-rtl" />
            </button>
          </div>
        </div>
        <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder={activeTab === 'featured' ? t('library.searchLibrary') : t('library.searchInstalled')} />
      </div>
    </>
  );
};

export default LibrarySearchHeader;
