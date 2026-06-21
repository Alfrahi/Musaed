'use client';

// Shared hooks layer - UI state only
// Feature-specific hooks are exported from each feature's store

export {
  useIsStreaming,
  useIsInitialized,
  useIsHydrated,
  useIsOllamaConnected,
  useUIError,
  useIsSettingsOpen,
  useIsLibraryOpen,
  useIsInfoOpen,
  useSetStreaming,
  useSetInitialized,
  useSetHydrated,
  useSetOllamaConnected,
  useSetUIError,
  useSetSettingsOpen,
  useSetLibraryOpen,
  useSetInfoOpen,
} from './ui-store';

// Coordination hooks
export { coordinateStartStream, coordinateStopStream, flushAndStop } from './coordination';
