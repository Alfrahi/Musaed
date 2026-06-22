'use client';

import { useCallback } from 'react';
import { ragApi, listen } from '@/lib/ipc';
import { useSetRagIndexProgress, useUpdateRagProject } from '@/features/rag/store/rag-store';
import { useOllamaUrl } from '@/features/settings/store/settings-store';
import { IndexProgressSchema, IndexCompleteSchema, IndexErrorSchema } from '@musaed/contracts';
import type { IndexProgress, IndexComplete, IndexError } from '@musaed/contracts';

export function useRagIndexing() {
  const setIndexProgress = useSetRagIndexProgress();
  const updateProject = useUpdateRagProject();
  const ollamaUrl = useOllamaUrl();

  const startIndexing = useCallback(
    async (projectId: string, force?: boolean) => {
      return ragApi.indexProject(projectId, force, ollamaUrl);
    },
    [ollamaUrl]
  );

  const abortIndexing = useCallback(async (projectId: string) => {
    return ragApi.abortIndex(projectId);
  }, []);

  const reindexProject = useCallback(
    async (projectId: string) => {
      return ragApi.reindexProject(projectId, ollamaUrl);
    },
    [ollamaUrl]
  );

  // Listen for indexing events
  const startIndexEventListeners = useCallback(() => {
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      // Progress events
      const unlistenProgress = await listen<IndexProgress>(
        'rag-index-progress',
        (payload) => {
          setIndexProgress(payload.projectId, payload);
        },
        IndexProgressSchema
      );
      unlisteners.push(unlistenProgress);

      // Complete events
      const unlistenComplete = await listen<IndexComplete>(
        'rag-index-complete',
        (payload) => {
          updateProject(payload.projectId, {
            status: 'ready',
            indexedAt: payload.indexedAt,
            fileCount: payload.fileCount,
            chunkCount: payload.chunkCount,
            totalBytes: payload.totalBytes,
          });
        },
        IndexCompleteSchema
      );
      unlisteners.push(unlistenComplete);

      // Error events
      const unlistenError = await listen<IndexError>(
        'rag-index-error',
        (payload) => {
          updateProject(payload.projectId, { status: 'error' });
        },
        IndexErrorSchema
      );
      unlisteners.push(unlistenError);
    };

    setup();

    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [setIndexProgress, updateProject]);

  return {
    startIndexing,
    abortIndexing,
    reindexProject,
    startIndexEventListeners,
  };
}
