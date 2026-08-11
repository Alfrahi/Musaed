'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';

/** Sidebar tab kinds. Lifted out of `Sidebar.tsx`'s local `useState` so
 *  non-sidebar surfaces (notably `RagContextBadge` in `components/ui`) can
 *  programmatically route the user to the Projects tab without crossing the
 *  feature boundary into `features/sidebar`. STANDARDS §3 — feature import
 *  rules forbid `components/ui` from reaching into the sidebar barrel. */
export type SidebarTab = 'chats' | 'projects';

/** Which modal is currently open, or `null` when none is open. */
export type ModalKind =
  'settings' | 'library' | 'info' | 'cheatsheet' | 'commandPalette' | 'search';

interface UIState {
  isStreaming: boolean;
  isInitialized: boolean;
  isHydrated: boolean;
  isOllamaConnected: boolean;
  errorMessage: string | null;
  activeModal: ModalKind | null;
  sidebarTab: SidebarTab;
  showAddProject: boolean;
  /** Counter for pending store rehydrations. Decremented by each store's onRehydrateStorage callback. */
  _pendingRehydrations: number;
  setStreaming: (isStreaming: boolean) => void;
  setInitialized: (isInitialized: boolean) => void;
  setHydrated: (isHydrated: boolean) => void;
  setOllamaConnected: (isConnected: boolean) => void;
  setErrorMessage: (errorMessage: string | null) => void;
  openModal: (kind: ModalKind) => void;
  closeModal: () => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setShowAddProject: (show: boolean) => void;
  /** Called before rehydration starts. Increments the pending counter by `count`. */
  setPendingRehydrations: (count: number) => void;
  /** Called by store's onRehydrateStorage when rehydration completes. */
  onStoreRehydrated: () => void;
}

// Selectors for the UI store
export const selectIsAnyModalOpen = (state: UIState) => state.activeModal !== null;

export const selectHasError = (state: UIState) => !!state.errorMessage;

export const useUIStore = createWithEqualityFn<UIState>()(
  (set) => ({
    isStreaming: false,
    isInitialized: false,
    isHydrated: false,
    isOllamaConnected: false,
    errorMessage: null,
    activeModal: null,
    sidebarTab: 'chats',
    showAddProject: false,
    _pendingRehydrations: 0,
    setStreaming: (isStreaming) => set({ isStreaming }),
    setInitialized: (isInitialized) => set({ isInitialized }),
    setHydrated: (isHydrated) => set({ isHydrated }),
    setOllamaConnected: (isOllamaConnected) => set({ isOllamaConnected }),
    setErrorMessage: (errorMessage) => set({ errorMessage }),
    openModal: (kind) => set({ activeModal: kind }),
    closeModal: () => set({ activeModal: null }),
    setSidebarTab: (sidebarTab) => set({ sidebarTab }),
    setShowAddProject: (showAddProject) => set({ showAddProject }),
    setPendingRehydrations: (count) => set({ _pendingRehydrations: count }),
    onStoreRehydrated: () =>
      set((state) => {
        const next = state._pendingRehydrations - 1;
        return {
          _pendingRehydrations: next,
          isHydrated: next <= 0,
        };
      }),
  }),
  shallow
);

// UI Store hooks - these are the ONLY store hooks that should be in the shared layer
export const useIsStreaming = () => useUIStore((s) => s.isStreaming);
export const useIsInitialized = () => useUIStore((s) => s.isInitialized);
export const useIsHydrated = () => useUIStore((s) => s.isHydrated);
export const useIsOllamaConnected = () => useUIStore((s) => s.isOllamaConnected);
export const useUIError = () => useUIStore((s) => s.errorMessage);
export const useActiveModal = () => useUIStore((s) => s.activeModal);
export const useOpenModal = () => useUIStore((s) => s.openModal);
export const useCloseModal = () => useUIStore((s) => s.closeModal);

// Backward-compat hooks: check activeModal against a specific kind.
export const useIsSettingsOpen = () => useUIStore((s) => s.activeModal === 'settings');
export const useIsLibraryOpen = () => useUIStore((s) => s.activeModal === 'library');
export const useIsInfoOpen = () => useUIStore((s) => s.activeModal === 'info');

// `setStreaming` is intentionally NOT exposed as a public hook. It is a
// private action called only from `store/coordination.ts` so that the
// `isStreaming` invariant is enforced in exactly one place
// (see STANDARDS.md §9 — stream orchestration).
export const useSetInitialized = () => useUIStore((s) => s.setInitialized);
export const useSetHydrated = () => useUIStore((s) => s.setHydrated);
export const useSetOllamaConnected = () => useUIStore((s) => s.setOllamaConnected);
export const useSetUIError = () => useUIStore((s) => s.setErrorMessage);
export const useSidebarTab = () => useUIStore((s) => s.sidebarTab);
export const useSetSidebarTab = () => useUIStore((s) => s.setSidebarTab);
export const useShowAddProject = () => useUIStore((s) => s.showAddProject);
export const useSetShowAddProject = () => useUIStore((s) => s.setShowAddProject);
