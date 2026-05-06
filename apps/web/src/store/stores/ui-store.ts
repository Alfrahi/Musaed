'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';

interface UIState {
  isStreaming: boolean;
  isInitialized: boolean;
  isHydrated: boolean;
  isOllamaConnected: boolean;
  errorMessage: string | null;
  isSettingsOpen: boolean;
  isLibraryOpen: boolean;
  isInfoOpen: boolean;
  setStreaming: (isStreaming: boolean) => void;
  setInitialized: (isInitialized: boolean) => void;
  setHydrated: (isHydrated: boolean) => void;
  setOllamaConnected: (isConnected: boolean) => void;
  setErrorMessage: (errorMessage: string | null) => void;
  setSettingsOpen: (isSettingsOpen: boolean) => void;
  setLibraryOpen: (isLibraryOpen: boolean) => void;
  setInfoOpen: (isInfoOpen: boolean) => void;
}

// Selectors for the UI store
export const selectIsAnyModalOpen = (state: UIState) =>
  state.isSettingsOpen || state.isLibraryOpen || state.isInfoOpen;

export const selectHasError = (state: UIState) => !!state.errorMessage;

export const useUIStore = createWithEqualityFn<UIState>()(
  (set) => ({
    isStreaming: false,
    isInitialized: false,
    isHydrated: false,
    isOllamaConnected: false,
    errorMessage: null,
    isSettingsOpen: false,
    isLibraryOpen: false,
    isInfoOpen: false,
    setStreaming: (isStreaming) => set({ isStreaming }),
    setInitialized: (isInitialized) => set({ isInitialized }),
    setHydrated: (isHydrated) => set({ isHydrated }),
    setOllamaConnected: (isOllamaConnected) => set({ isOllamaConnected }),
    setErrorMessage: (errorMessage) => set({ errorMessage }),
    setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
    setLibraryOpen: (isLibraryOpen) => set({ isLibraryOpen }),
    setInfoOpen: (isInfoOpen) => set({ isInfoOpen }),
  }),
  shallow
);
