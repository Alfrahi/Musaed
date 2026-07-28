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
  useSetCheatsheetOpen,
  useSetCommandPaletteOpen,
} from '@/store/ui-store';

// Coordination hooks - re-export from coordination module
// These are store-agnostic streaming lifecycle functions
export {
  coordinateStartStream,
  coordinateStopStream,
  flushAndStop,
  stopBatching,
} from '@/store/coordination';
