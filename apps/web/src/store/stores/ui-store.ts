'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';

interface UIState {
  isStreaming: boolean;
  isInitialized: boolean;
  isHydrated: boolean;
  isOllamaConnected: boolean;
  error: string | null;
  isSettingsOpen: boolean;
  isLibraryOpen: boolean;
  isInfoOpen: boolean;
  setStreaming: (isStreaming: boolean) => void;
  setInitialized: (isInitialized: boolean) => void;
  setHydrated: (isHydrated: boolean) => void;
  setOllamaConnected: (isConnected: boolean) => void;
  setError: (error: string | null) => void;
  setSettingsOpen: (isSettingsOpen: boolean) => void;
  setLibraryOpen: (isLibraryOpen: boolean) => void;
  setInfoOpen: (isInfoOpen: boolean) => void;
}

// Selectors for the UI store
export const selectIsAnyModalOpen = (state: UIState) =>
  state.isSettingsOpen || state.isLibraryOpen || state.isInfoOpen;

export const selectHasError = (state: UIState) => !!state.error;

export const useUIStore = createWithEqualityFn<UIState>()(
  (set) => ({
    isStreaming: false,
    isInitialized: false,
    isHydrated: false,
    isOllamaConnected: false,
    error: null,
    isSettingsOpen: false,
    isLibraryOpen: false,
    isInfoOpen: false,
    setStreaming: (isStreaming) => set({ isStreaming }),
    setInitialized: (isInitialized) => set({ isInitialized }),
    setHydrated: (isHydrated) => set({ isHydrated }),
    setOllamaConnected: (isOllamaConnected) => set({ isOllamaConnected }),
    setError: (error) => set({ error }),
    setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
    setLibraryOpen: (isLibraryOpen) => set({ isLibraryOpen }),
    setInfoOpen: (isInfoOpen) => set({ isInfoOpen }),
  }),
  shallow
);
