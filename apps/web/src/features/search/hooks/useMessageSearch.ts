'use client';

import { useState, useCallback, useRef } from 'react';
import { conversationApi } from '@/lib/ipc';
import type { MessageSearchResult } from '@musaed/contracts';

const DEFAULT_LIMIT = 50;
const DEBOUNCE_MS = 300;

interface UseMessageSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  results: MessageSearchResult[];
  isSearching: boolean;
  error: string | null;
}

/**
 * Hook for searching messages across all conversations.
 *
 * Debounces the search query by 300ms and calls the Rust backend
 * via `conversationApi.searchMessages`. Results are grouped by
 * conversation and ordered by recency.
 *
 * A monotonic request counter guards against stale responses: each
 * query gets a unique ID, and only the response whose ID matches the
 * latest one is committed. This prevents a slower earlier query from
 * overwriting the results of a faster later one.
 */
export function useMessageSearch(): UseMessageSearchReturn {
  const [query, setQueryRaw] = useState('');
  const [results, setResults] = useState<MessageSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmed = q.trim();
    if (!trimmed) {
      // Bump the ID so any in-flight request is rendered stale.
      requestIdRef.current++;
      setResults([]);
      setIsSearching(false);
      setError(null);
      return;
    }

    setIsSearching(true);
    setError(null);

    const currentRequestId = ++requestIdRef.current;

    debounceRef.current = setTimeout(async () => {
      try {
        const data = await conversationApi.searchMessages(trimmed, DEFAULT_LIMIT);
        // Guard against stale responses — only commit if this is still the
        // latest request. A newer keystroke would have bumped the ref.
        if (currentRequestId !== requestIdRef.current) return;
        if (data) {
          setResults(data);
        } else {
          setResults([]);
        }
      } catch (err) {
        if (currentRequestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setResults([]);
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setIsSearching(false);
        }
      }
    }, DEBOUNCE_MS);
  }, []);

  return { query, setQuery, results, isSearching, error };
}
