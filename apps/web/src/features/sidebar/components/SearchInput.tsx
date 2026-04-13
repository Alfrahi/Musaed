"use client";

import { Search } from 'lucide-react';
import { useConversationStore, useSettingsStore } from '../../../store';
import { useTranslation } from '../../../lib/i18n';

const SearchInput = () => {
  const { searchQuery, setSearchQuery } = useConversationStore();
  const { globalSettings } = useSettingsStore();
  const { t } = useTranslation(globalSettings.language);

  return (
    <div className="relative group ps-4 pe-4 mbe-4" role="search">
      <Search 
        size={14} 
        className="absolute start-7 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-blue-500 transition-colors" 
        aria-hidden="true"
      />
      <input 
        type="text"
        placeholder={t('sidebar.searchChats')}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full bg-zinc-200/50 dark:bg-zinc-800/50 border-none rounded-lg py-2 ps-9 pe-3 text-xs outline-none focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
        aria-label={t('sidebar.searchChats')}
      />
    </div>
  );
};

export default SearchInput;