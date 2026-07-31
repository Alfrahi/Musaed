'use client';

import { useCallback } from 'react';
import { ragApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';
import { useActiveRagProject } from '@/store/rag-store';
import { useOllamaUrl } from '@/store/settings-store';
import type { AssembledContext } from '@musaed/contracts';

/**
 * Hook for assembling RAG context for a chat query.
 *
 * This is the public API that other features (e.g. conversation) use to
 * fetch RAG context without calling `ragApi` directly. The rag feature
 * owns `cmd_rag_assemble_context` — external consumers go through this hook.
 */
export function useRagAssembleContext() {
  const activeProject = useActiveRagProject();
  const ollamaUrl = useOllamaUrl();

  const assembleContext = useCallback(
    async (query: string): Promise<AssembledContext | null> => {
      if (!activeProject) return null;

      try {
        const result = await ragApi.assembleContext({
          projectId: activeProject.id,
          query,
          topK: 10,
          baseUrl: ollamaUrl,
        });
        return result;
      } catch (err) {
        logger.warn('RAG context assembly failed:', { error: String(err) });
        return null;
      }
    },
    [activeProject, ollamaUrl]
  );

  return { assembleContext, activeProject };
}
