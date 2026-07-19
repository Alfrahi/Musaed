'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { RagProject, IndexProgress, SearchResult } from '@musaed/contracts';
import { createTauriStorage } from '@/lib/tauri-storage';
import { useUIStore } from '@/store/ui-store';
import { ragMigrations, validateRag } from '@/lib/migrations';

const RAG_STORE_VERSION = 3;

export interface RagState {
  projects: Record<string, RagProject>;
  projectIds: string[];
  activeProjectId: string | null;
  searchResults: SearchResult[];
  isSearching: boolean;

  // Actions
  setProjects: (projects: RagProject[]) => void;
  addProject: (project: RagProject) => void;
  removeProject: (projectId: string) => void;
  updateProject: (projectId: string, updates: Partial<RagProject>) => void;
  setActiveProjectId: (id: string | null) => void;
  setIndexProgress: (projectId: string, progress: IndexProgress | null) => void;
  setSearchResults: (results: SearchResult[]) => void;
  setIsSearching: (isSearching: boolean) => void;
  /** Resync projectIds from project keys — guards against partialize desync. */
  normalize: () => void;
  reset: () => void;
}

const initialState = {
  projects: {} as Record<string, RagProject>,
  projectIds: [] as string[],
  activeProjectId: null as string | null,
  searchResults: [] as SearchResult[],
  isSearching: false,
};

export const useRagStore = createWithEqualityFn<RagState>()(
  persist(
    (set) => ({
      ...initialState,

      setProjects: (projects: RagProject[]) =>
        set((_state: RagState) => {
          const projectsMap: Record<string, RagProject> = {};
          const ids: string[] = [];
          for (const p of projects) {
            projectsMap[p.id] = p;
            ids.push(p.id);
          }
          return { projects: projectsMap, projectIds: ids };
        }),

      addProject: (project: RagProject) =>
        set((state: RagState) => ({
          projects: { ...state.projects, [project.id]: project },
          projectIds: [...state.projectIds, project.id],
        })),

      removeProject: (projectId: string) =>
        set((state: RagState) => {
          const { [projectId]: _, ...rest } = state.projects;
          return {
            projects: rest,
            projectIds: state.projectIds.filter((id: string) => id !== projectId),
            activeProjectId: state.activeProjectId === projectId ? null : state.activeProjectId,
          };
        }),

      updateProject: (projectId: string, updates: Partial<RagProject>) =>
        set((state: RagState) => {
          const existing = state.projects[projectId];
          if (!existing) return state;
          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...existing,
                ...updates,
                // Preserve retry state unless explicitly updated
                retryAttempts: updates.retryAttempts ?? existing.retryAttempts,
                lastError: updates.lastError ?? existing.lastError,
              },
            },
          };
        }),

      setActiveProjectId: (id: string | null) => set({ activeProjectId: id }),

      setIndexProgress: (projectId: string, progress: IndexProgress | null) =>
        set((state: RagState) => {
          const existing = state.projects[projectId];
          if (!existing) return state;

          // Reset retryAttempts when starting a new indexing operation
          const retryAttempts =
            progress?.phase === 'discoveringFiles' && progress.current > 0 && progress.total === 3
              ? progress.current // This indicates a retry attempt
              : progress?.phase === 'discoveringFiles'
                ? 0 // New indexing operation
                : (existing.retryAttempts ?? 0);

          // Capture last error when phase is failed
          const lastError =
            progress?.phase === 'failed' && progress.message
              ? progress.message
              : (existing.lastError ?? null);

          return {
            projects: {
              ...state.projects,
              [projectId]: {
                ...existing,
                status: progress
                  ? progress.phase === 'completed'
                    ? 'ready'
                    : progress.phase === 'failed'
                      ? 'error'
                      : 'indexing'
                  : existing.status,
                retryAttempts,
                lastError,
              },
            },
          };
        }),

      setSearchResults: (results: SearchResult[]) => set({ searchResults: results }),

      setIsSearching: (isSearching: boolean) => set({ isSearching }),

      normalize: () =>
        set((state: RagState) => {
          const validIds = state.projectIds.filter((id) => id in state.projects);
          if (validIds.length !== state.projectIds.length) {
            return { projectIds: validIds };
          }
          return state;
        }),

      reset: () => set(initialState),
    }),
    {
      name: 'rag-state',
      storage: createJSONStorage(() =>
        createTauriStorage('rag-state.json', RAG_STORE_VERSION, ragMigrations)
      ),
      version: RAG_STORE_VERSION,
      migrate: (persistedState: unknown, version: number) => {
        const fromVersion = typeof version === 'number' ? version : 0;
        let data: unknown = persistedState;
        const registry = ragMigrations as unknown as Record<number, (d: unknown) => unknown>;
        for (let v = fromVersion + 1; v <= RAG_STORE_VERSION; v++) {
          const migration = registry[v];
          if (!migration) {
            // No-op guard — the orchestrator already raises MISSING_MIGRATION; here we
            // keep the legacy shape so a stale missing step does not blow up rehydration.
            break;
          }
          try {
            data = migration(data);
          } catch (err) {
            console.error(`RAG persist-migrate v${v} failed`, err);
            return persistedState;
          }
        }
        try {
          const validated = validateRag(data);
          return validated;
        } catch (err) {
          console.error('RAG persist-migrate validation failed', err);
          return persistedState;
        }
      },
      skipHydration: true,
      // Only persist these fields — search results and indexing progress are ephemeral
      partialize: (state: RagState) => ({
        projects: state.projects,
        projectIds: state.projectIds,
        activeProjectId: state.activeProjectId,
      }),
      onRehydrateStorage: () => {
        return (_state, error) => {
          if (error) {
            console.error('RAG store rehydration failed:', error);
          }
          useUIStore.getState().onStoreRehydrated();
        };
      },
    }
  ),
  shallow
);

// Export selector hooks for RAG store
export const useRagProjects = () => useRagStore((state) => state.projects);
export const useRagProjectIds = () => useRagStore((state) => state.projectIds);
export const useSetRagProjects = () => useRagStore((state) => state.setProjects);
export const useAddRagProject = () => useRagStore((state) => state.addProject);
export const useRemoveRagProject = () => useRagStore((state) => state.removeProject);
export const useUpdateRagProject = () => useRagStore((state) => state.updateProject);
export const useActiveRagProjectId = () => useRagStore((state) => state.activeProjectId);
export const useSetActiveRagProjectId = () => useRagStore((state) => state.setActiveProjectId);
export const useActiveRagProject = () => {
  const activeProjectId = useRagStore((state) => state.activeProjectId);
  const projects = useRagStore((state) => state.projects);
  return activeProjectId ? projects[activeProjectId] : null;
};
export const useRagSearchResults = () => useRagStore((state) => state.searchResults);
export const useSetRagSearchResults = () => useRagStore((state) => state.setSearchResults);
export const useSetIsRagSearching = () => useRagStore((state) => state.setIsSearching);
export const useSetRagIndexProgress = () => useRagStore((state) => state.setIndexProgress);
