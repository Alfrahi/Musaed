// Shared hooks layer - UI state only
// Feature-specific hooks are exported from each feature's store

export {
  useIsStreaming,
  useIsInitialized,
  useIsHydrated,
  useIsOllamaConnected,
  useUIError,
  useActiveModal,
  useOpenModal,
  useCloseModal,
  useIsSettingsOpen,
  useIsLibraryOpen,
  useIsInfoOpen,
  useSetInitialized,
  useSetHydrated,
  useSetOllamaConnected,
  useSetUIError,
} from '@/store/ui-store';

// Coordination hooks - re-export from coordination module
// These are store-agnostic streaming lifecycle functions
export {
  coordinateStartStream,
  stopStream,
  flushAndStop,
  type StopReason,
} from '@/store/coordination';
