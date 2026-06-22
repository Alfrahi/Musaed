'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { RagProject, IndexProgress, SearchResult } from '@musaed/contracts';
import { createTauriStorage } from '@/lib/tauri-storage';
import { useUIStore } from '@/store/ui-store';

const RAG_STORE_VERSION = 1;

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
              [projectId]: { ...existing, ...updates },
            },
          };
        }),

      setActiveProjectId: (id: string | null) => set({ activeProjectId: id }),

      setIndexProgress: (projectId: string, progress: IndexProgress | null) =>
        set((state: RagState) => {
          const existing = state.projects[projectId];
          if (!existing) return state;
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
      storage: createJSONStorage(() => createTauriStorage('rag-state.json', RAG_STORE_VERSION)),
      version: RAG_STORE_VERSION,
      migrate: (_persistedState, _version) => _persistedState,
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
