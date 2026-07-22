'use client';

import { useCallback } from 'react';
import { ragApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';
import {
  useSetRagSearchResults,
  useSetIsRagSearching,
  useSetRagSearchError,
} from '@/store/rag-store';
import { useOllamaUrl } from '@/store/settings-store';
import type { SearchResult } from '@musaed/contracts';

export function useRagSearch() {
  const setSearchResults = useSetRagSearchResults();
  const setIsSearching = useSetIsRagSearching();
  const setSearchError = useSetRagSearchError();
  const ollamaUrl = useOllamaUrl();

  const search = useCallback(
    async (args: {
      projectId: string;
      query: string;
      topK?: number;
      threshold?: number;
    }): Promise<SearchResult[] | null> => {
      setSearchError(null);
      setIsSearching(true);
      try {
        const results = await ragApi.search({ ...args, baseUrl: ollamaUrl });
        if (results) {
          setSearchResults(results);
        }
        return results;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error('RAG search failed', { error: errorMsg, projectId: args.projectId });
        setSearchError(errorMsg);
        setSearchResults([]);
        return null;
      } finally {
        setIsSearching(false);
      }
    },
    [setSearchResults, setIsSearching, setSearchError, ollamaUrl]
  );

  const clearResults = useCallback(() => {
    setSearchResults([]);
    setSearchError(null);
  }, [setSearchResults, setSearchError]);

  return { search, clearResults };
}
