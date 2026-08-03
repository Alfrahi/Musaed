'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useSearchQuery, useSetSearchQuery } from '@/store/conversation-store';
import { useLanguage } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { Input } from '@/components/ui/input';

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
        className="duration-fast absolute start-7 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors group-focus-within:text-blue-500"
        aria-hidden="true"
      />
      <Input
        type="text"
        placeholder={t('sidebar.searchChats')}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        className="text-caption duration-fast w-full border-none bg-zinc-200/50 px-3 ps-9 transition-colors focus-visible:ring-1 focus-visible:ring-blue-500/50 dark:bg-zinc-800/50"
        aria-label={t('sidebar.searchChats')}
      />
    </div>
  );
};

export default SearchInput;
