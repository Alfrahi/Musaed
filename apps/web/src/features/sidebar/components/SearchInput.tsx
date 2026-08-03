'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useSearchQuery, useSetSearchQuery } from '@/store/conversation-store';
import { useLanguage } from '@/store';
import { useTranslation } from '@/lib/i18n';

const SearchInput = () => {
  const searchQuery = useSearchQuery();
  const setSearchQuery = useSetSearchQuery();
  const language = useLanguage();
  const { t } = useTranslation(language);

  // Local state for debounced input
  const [inputValue, setInputValue] = useState(searchQuery);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync input when searchQuery changes externally (e.g., cleared by another component)
  useEffect(() => {
    setInputValue(searchQuery);
  }, [searchQuery]);

  // Debounce updates to the store
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setSearchQuery(inputValue);
    }, 300);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [inputValue, setSearchQuery]);

  return (
    <div className="group mbe-4 relative ps-4 pe-4" role="search">
      <Search
        size={14}
        className="absolute start-7 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors duration-150 group-focus-within:text-blue-500"
        aria-hidden="true"
      />
      <input
        type="text"
        placeholder={t('sidebar.searchChats')}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        className="w-full rounded-md border-none bg-zinc-200/50 py-2 ps-9 pe-3 text-xs transition-colors duration-150 outline-none placeholder:text-zinc-400 focus:ring-1 focus:ring-blue-500/50 dark:bg-zinc-800/50 dark:placeholder:text-zinc-500"
        aria-label={t('sidebar.searchChats')}
      />
    </div>
  );
};

export default SearchInput;
