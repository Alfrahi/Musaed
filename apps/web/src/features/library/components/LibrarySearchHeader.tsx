'use client';

import { useState } from 'react';
import { Search, ExternalLink, RefreshCw, X, HardDrive, Plus, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { type Language } from '@musaed/contracts';
import { openerApi } from '@/lib/ipc';
import { Button } from '@/components/ui/button';

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
  titleId: string;
}

/** Top bar with brand title and control buttons. */
const HeaderBar = ({
  title,
  titleId,
  subtitle,
  onRefresh,
  isRefreshing,
  onClose,
  refreshTitle,
}: {
  title: string;
  titleId: string;
  subtitle: string;
  onRefresh: () => void;
  isRefreshing: boolean;
  onClose: () => void;
  refreshTitle: string;
}) => (
  <div className="pbs-6 pbe-6 flex items-center justify-between border-b border-zinc-100 ps-6 pe-6 dark:border-zinc-800">
    <div className="flex items-center gap-4">
      <div className="shadow-pro flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white shadow-blue-500/20">
        <HardDrive size={20} />
      </div>
      <div>
        <h2 id={titleId} className="text-xl font-bold tracking-tight">
          {title}
        </h2>
        <p className="text-caption font-medium tracking-widest text-zinc-500 uppercase">
          {subtitle}
        </p>
      </div>
    </div>
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={onRefresh}
        className={cn(
          'rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800',
          isRefreshing && 'animate-spin text-blue-500'
        )}
        title={refreshTitle}
      >
        <RefreshCw size={20} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <X size={24} />
      </Button>
    </div>
  </div>
);

/** Tab buttons for Featured / Installed. */
const TabBar = ({
  activeTab,
  setActiveTab,
  featuredLabel,
  installedLabel,
}: {
  activeTab: 'featured' | 'installed';
  setActiveTab: (t: 'featured' | 'installed') => void;
  featuredLabel: string;
  installedLabel: string;
}) => (
  <div className="flex w-fit rounded-lg bg-zinc-200/50 p-1 dark:bg-zinc-800/50">
    {(['featured', 'installed'] as const).map((tab) => (
      <button
        key={tab}
        onClick={() => setActiveTab(tab)}
        className={cn(
          'text-caption cursor-pointer rounded-md px-4 py-1.5 font-bold tracking-widest uppercase transition-all',
          activeTab === tab
            ? 'shadow-native bg-white text-blue-600 dark:bg-zinc-700'
            : 'text-zinc-500 hover:text-zinc-700'
        )}
      >
        {tab === 'featured' ? featuredLabel : installedLabel}
      </button>
    ))}
  </div>
);

/** Custom model pull input with terminal icon. */
const CustomPullForm = ({
  onPullAny,
  placeholder,
  buttonTitle,
}: {
  onPullAny: (name: string) => void;
  placeholder: string;
  buttonTitle: string;
}) => {
  const [customModel, setCustomModel] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customModel.trim()) {
      onPullAny(customModel.trim());
      setCustomModel('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex min-w-[200px] flex-1 items-center gap-2">
      <div className="relative flex-1">
        <Terminal size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          placeholder={placeholder}
          value={customModel}
          onChange={(e) => setCustomModel(e.target.value)}
          className="text-caption w-full rounded-lg border border-zinc-200 bg-white py-2 ps-9 pe-3 font-mono transition-all outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800"
        />
      </div>
      <Button
        type="submit"
        variant="secondary"
        size="icon"
        disabled={!customModel.trim()}
        className="rounded-lg active:scale-95 disabled:opacity-50"
        title={buttonTitle}
      >
        <Plus size={18} />
      </Button>
    </form>
  );
};

/** Search input for filtering models. */
const SearchBar = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) => (
  <div className="relative w-full">
    <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-body w-full rounded-lg border border-zinc-200 bg-white py-2.5 ps-10 pe-4 transition-all outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800"
    />
  </div>
);

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
  onPullAny,
  titleId,
}: LibrarySearchHeaderProps) => {
  const { t } = useTranslation(language);

  return (
    <>
      <HeaderBar
        title={t('library.modelManager')}
        titleId={titleId}
        subtitle={t('library.localIntelligence')}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onClose={onClose}
        refreshTitle={t('library.refreshModels')}
      />
      <div className="space-y-4 border-b border-zinc-100 bg-zinc-50/50 py-4 ps-6 pe-6 dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <TabBar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            featuredLabel={t('library.title')}
            installedLabel={t('library.installed', { count: installedCount })}
          />
          <CustomPullForm
            onPullAny={onPullAny}
            placeholder={t('library.pullFromOllama', { name: 'llama3:8b' })}
            buttonTitle={t('library.pullModel')}
          />
          <div className="caption-xs hidden items-center gap-4 font-bold tracking-widest text-zinc-500 uppercase lg:flex">
            {}
            <button
              onClick={() => openerApi.openUrl('https://ollama.com/library')}
              className="flex cursor-pointer items-center gap-1 transition-colors hover:text-blue-500"
            >
              {t('library.ollamaLibrary')} <ExternalLink size={12} className="mirror-rtl" />
            </button>
          </div>
        </div>
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={
            activeTab === 'featured' ? t('library.searchLibrary') : t('library.searchInstalled')
          }
        />
      </div>
    </>
  );
};

export default LibrarySearchHeader;
