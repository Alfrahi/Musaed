'use client';

import { useCallback, useRef, useEffect } from 'react';
import {
  useActiveRagProject,
  useSetActiveRagProjectId,
  useRagSearchResults,
} from '@/store/rag-store';
import { ragApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';

export function useRagContext() {
  const activeProject = useActiveRagProject();
  const setActiveProjectId = useSetActiveRagProjectId();
  const searchResults = useRagSearchResults();

  // Cache assembled context for the current query to avoid re-searching
  const contextCache = useRef<Map<string, string>>(new Map());

  const activateProject = useCallback(
    (projectId: string | null) => {
      setActiveProjectId(projectId);
    },
    [setActiveProjectId]
  );

  const searchAndBuildContext = useCallback(
    async (query: string): Promise<string> => {
      if (!activeProject) return '';

      // Check cache
      const cacheKey = `${activeProject.id}:${query}`;
      const cached = contextCache.current.get(cacheKey);
      if (cached) return cached;

      // Delegate search + assembly to Rust via single IPC call
      try {
        const result = await ragApi.assembleContext({
          projectId: activeProject.id,
          query,
          topK: 10,
        });

        if (result && result.assembledContext) {
          // Cache the result
          contextCache.current.set(cacheKey, result.assembledContext);

          // Prune cache if too large
          if (contextCache.current.size > 50) {
            const firstKey = contextCache.current.keys().next().value;
            if (firstKey) contextCache.current.delete(firstKey);
          }

          return result.assembledContext;
        }
      } catch (err) {
        logger.warn('RAG context assembly failed:', { error: String(err) });
      }

      return '';
    },
    [activeProject]
  );

  // Clear cache when project changes
  useEffect(() => {
    contextCache.current.clear();
  }, [activeProject?.id]);

  return {
    activeProject,
    activateProject,
    searchAndBuildContext,
    searchResults,
  };
}
