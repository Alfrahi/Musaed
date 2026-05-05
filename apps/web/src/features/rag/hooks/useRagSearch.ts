'use client';

import { useCallback } from 'react';
import { ragApi } from '../../../lib/ipc';
import { useSetRagSearchResults, useSetIsRagSearching, useOllamaUrl } from '../../../store/hooks';
import type { SearchResult } from '@musaed/contracts';

export function useRagSearch() {
  const setSearchResults = useSetRagSearchResults();
  const setIsSearching = useSetIsRagSearching();
  const ollamaUrl = useOllamaUrl();

  const search = useCallback(
    async (args: {
      projectId: string;
      query: string;
      topK?: number;
      threshold?: number;
    }): Promise<SearchResult[] | null> => {
      setIsSearching(true);
      try {
        const results = await ragApi.search({ ...args, baseUrl: ollamaUrl });
        if (results) {
          setSearchResults(results);
        }
        return results;
      } finally {
        setIsSearching(false);
      }
    },
    [setSearchResults, setIsSearching, ollamaUrl]
  );

  const clearResults = useCallback(() => {
    setSearchResults([]);
  }, [setSearchResults]);

  return { search, clearResults };
}
