'use client';

import { useCallback, useRef, useEffect } from 'react';
import {
  useActiveRagProject,
  useSetActiveRagProjectId,
  useRagSearchResults,
} from '../../../store/hooks';
import { useRagSearch } from './useRagSearch';
import { buildRagSystemContext } from '../utils/context-assembler';

export function useRagContext() {
  const activeProject = useActiveRagProject();
  const setActiveProjectId = useSetActiveRagProjectId();
  const searchResults = useRagSearchResults();
  const { search } = useRagSearch();

  // Cache search results for the current query to avoid re-searching
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

      // Search
      const results = await search({
        projectId: activeProject.id,
        query,
        topK: 10,
      });

      if (!results || results.length === 0) return '';

      const context = buildRagSystemContext(results, activeProject.path);

      // Cache the result
      contextCache.current.set(cacheKey, context);

      // Prune cache if too large
      if (contextCache.current.size > 50) {
        const firstKey = contextCache.current.keys().next().value;
        if (firstKey) contextCache.current.delete(firstKey);
      }

      return context;
    },
    [activeProject, search]
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
