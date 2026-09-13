'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createTauriStorage } from '@/lib/tauri-storage';

const MAX_RECENT_SEARCHES = 8;

interface RecentSearchesState {
  /** Most-recent-first list of committed search queries. */
  recentSearches: string[];
  /** Adds a query to the front, dedupes, and caps the list length. */
  addRecentSearch: (query: string) => void;
  /** Removes a single query from the list. */
  removeRecentSearch: (query: string) => void;
  /** Clears the entire list. */
  clearRecentSearches: () => void;
}

/**
 * Feature-private store for the search modal's "recent searches" list.
 *
 * Persisted via the same `createTauriStorage` engine as the global stores so
 * the list survives restarts in both Tauri and web-dev (localStorage) modes.
 * No migrations are needed: the shape is a flat string array and any legacy
 * or malformed value is discarded on rehydrate.
 */
export const useRecentSearchesStore = createWithEqualityFn<RecentSearchesState>()(
  persist(
    (set) => ({
      recentSearches: [],
      addRecentSearch: (query) =>
        set((state) => {
          const trimmed = query.trim();
          if (!trimmed) return state;
          const deduped = state.recentSearches.filter((q) => q !== trimmed);
          return { recentSearches: [trimmed, ...deduped].slice(0, MAX_RECENT_SEARCHES) };
        }),
      removeRecentSearch: (query) =>
        set((state) => ({
          recentSearches: state.recentSearches.filter((q) => q !== query),
        })),
      clearRecentSearches: () => set({ recentSearches: [] }),
    }),
    {
      name: 'musaed-recent-searches-storage',
      storage: createJSONStorage(() => createTauriStorage('recent-searches-state.json', 1)),
      version: 1,
      skipHydration: true,
      onRehydrateStorage: () => (state, error) => {
        if (error) return;
        if (state && !Array.isArray(state.recentSearches)) {
          state.recentSearches = [];
        }
      },
    }
  ),
  shallow
);
