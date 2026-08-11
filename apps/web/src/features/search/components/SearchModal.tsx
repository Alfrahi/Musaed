'use client';

import { useCallback, useEffect, useId, useRef, useState, memo } from 'react';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/store';
import { useSetCurrentConversationId } from '@/store/conversation-store';
import { ModalLayout, InlineError } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { useMessageSearch } from '../hooks/useMessageSearch';
import type { MessageSearchResult } from '@musaed/contracts';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SearchResultItemProps {
  result: MessageSearchResult;
  index: number;
  isActive: boolean;
  onSelect: (result: MessageSearchResult) => void;
  onHover: (index: number) => void;
  roleUserLabel: string;
  roleAssistantLabel: string;
}

const SearchResultItem = memo(function SearchResultItem({
  result,
  index,
  isActive,
  onSelect,
  onHover,
  roleUserLabel,
  roleAssistantLabel,
}: SearchResultItemProps) {
  return (
    <Button
      variant="ghost"
      size="md"
      id={`search-result-${index}`}
      role="option"
      data-index={index}
      data-active={isActive}
      aria-selected={isActive}
      onClick={() => onSelect(result)}
      onMouseEnter={() => onHover(index)}
      className={cn(
        'h-auto w-full justify-start rounded-none px-4 py-3 text-start',
        isActive ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
      )}
    >
      <div className="flex w-full flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="caption-xs text-zinc-400">{result.conversationTitle}</span>
          <span
            className={cn(
              'caption-xs rounded px-1.5 py-0.5 font-medium',
              result.message.role === 'user'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
            )}
          >
            {result.message.role === 'user' ? roleUserLabel : roleAssistantLabel}
          </span>
        </div>
        <p className="text-body line-clamp-2 text-zinc-700 dark:text-zinc-300">
          {result.message.content}
        </p>
      </div>
    </Button>
  );
});

interface SearchInputProps {
  query: string;
  onQueryChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder: string;
  isSearching: boolean;
  resultsCount: number;
  activeIndex: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

const SearchInput = memo(function SearchInput({
  query,
  onQueryChange,
  onKeyDown,
  placeholder,
  isSearching,
  resultsCount,
  activeIndex,
  inputRef,
}: SearchInputProps) {
  return (
    <div className="border-be border-zinc-100 px-4 py-3 dark:border-zinc-800">
      <div className="relative">
        <svg
          className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="text-body w-full rounded-md border border-zinc-200 bg-zinc-50 py-2 ps-10 pe-4 transition-colors outline-none placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500 dark:focus:border-zinc-600 dark:focus:bg-zinc-950"
          aria-label={placeholder}
          role="combobox"
          aria-expanded={resultsCount > 0}
          aria-controls="search-results-list"
          aria-activedescendant={resultsCount > 0 ? `search-result-${activeIndex}` : undefined}
          autoComplete="off"
        />
        {isSearching && (
          <div className="absolute end-3 top-1/2 -translate-y-1/2">
            <svg
              className="h-4 w-4 animate-spin text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
});

interface SearchResultsListProps {
  listRef: React.RefObject<HTMLDivElement | null>;
  results: MessageSearchResult[];
  activeIndex: number;
  onSelect: (result: MessageSearchResult) => void;
  onHover: (index: number) => void;
  roleUserLabel: string;
  roleAssistantLabel: string;
  hasQuery: boolean;
  isSearching: boolean;
  error: string | null;
  emptyLabel: string;
  startTypingLabel: string;
}

const SearchResultsList = memo(function SearchResultsList({
  listRef,
  results,
  activeIndex,
  onSelect,
  onHover,
  roleUserLabel,
  roleAssistantLabel,
  hasQuery,
  isSearching,
  error,
  emptyLabel,
  startTypingLabel,
}: SearchResultsListProps) {
  const showResults = hasQuery && results.length > 0;
  const showEmpty = hasQuery && !isSearching && results.length === 0 && !error;
  const showError = hasQuery && error;

  return (
    <div ref={listRef} id="search-results-list" role="listbox" className="max-h-80 overflow-y-auto">
      {showResults &&
        results.map((result, index) => (
          <SearchResultItem
            key={`${result.message.id}-${index}`}
            result={result}
            index={index}
            isActive={index === activeIndex}
            onSelect={onSelect}
            onHover={onHover}
            roleUserLabel={roleUserLabel}
            roleAssistantLabel={roleAssistantLabel}
          />
        ))}

      {showEmpty && (
        <div className="px-4 py-8 text-center">
          <p className="text-body text-zinc-400">{emptyLabel}</p>
        </div>
      )}

      {showError && error && (
        <div className="px-4 py-8">
          <InlineError message={error} />
        </div>
      )}

      {!hasQuery && (
        <div className="px-4 py-8 text-center">
          <p className="text-body text-zinc-400">{startTypingLabel}</p>
        </div>
      )}
    </div>
  );
});

/**
 * Full-text search modal for messages across all conversations.
 *
 * Features:
 * - Live search as you type (debounced 300ms via useMessageSearch)
 * - Results grouped by conversation with matching snippet
 * - Role badge (user/assistant) and timestamp
 * - Keyboard navigation (arrow keys, Enter to select, Escape to close)
 * - Clicking a result navigates to that conversation
 */
const SearchModal = ({ isOpen, onClose }: SearchModalProps) => {
  const titleId = useId();
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const setCurrentConversationId = useSetCurrentConversationId();

  const { query, setQuery, results, isSearching, error } = useMessageSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [isOpen, setQuery]);

  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  const handleSelect = useCallback(
    (result: MessageSearchResult) => {
      setCurrentConversationId(result.conversationId);
      onClose();
    },
    [setCurrentConversationId, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && results.length > 0) {
        e.preventDefault();
        handleSelect(results[activeIndex]);
      }
    },
    [results, activeIndex, handleSelect]
  );

  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector('[data-active="true"]');
      activeEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const hasQuery = query.trim().length > 0;

  return (
    <ModalLayout isOpen={isOpen} onClose={onClose} titleId={titleId} maxWidth="max-w-lg">
      <div className="flex flex-col">
        <div className="border-be border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h2 id={titleId} className="text-body font-semibold">
            {t('search.title')}
          </h2>
        </div>

        <SearchInput
          query={query}
          onQueryChange={setQuery}
          onKeyDown={handleKeyDown}
          placeholder={t('search.placeholder')}
          isSearching={isSearching}
          resultsCount={results.length}
          activeIndex={activeIndex}
          inputRef={inputRef}
        />

        <SearchResultsList
          listRef={listRef}
          results={results}
          activeIndex={activeIndex}
          onSelect={handleSelect}
          onHover={setActiveIndex}
          roleUserLabel={t('search.roleUser')}
          roleAssistantLabel={t('search.roleAssistant')}
          hasQuery={hasQuery}
          isSearching={isSearching}
          error={error}
          emptyLabel={t('search.noResults')}
          startTypingLabel={t('search.startTyping')}
        />
      </div>
    </ModalLayout>
  );
};

export default SearchModal;
