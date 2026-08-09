// Auto-mocked ui-store for tests
import { vi } from 'vitest';
import * as actual from '@/store/ui-store';

// Preserve original hooks that tests may rely on
export const useUIStore = actual.useUIStore;

// Mock the error setter used by chat send/stream hooks
export const useSetUIError = vi.fn();

// Re-export hooks to avoid missing exports
export const useIsStreaming = actual.useIsStreaming;
export const useIsInitialized = actual.useIsInitialized;
export const useIsHydrated = actual.useIsHydrated;
export const useIsOllamaConnected = actual.useIsOllamaConnected;
export const useUIError = actual.useUIError;
export const useIsSettingsOpen = actual.useIsSettingsOpen;
export const useIsLibraryOpen = actual.useIsLibraryOpen;
export const useIsInfoOpen = actual.useIsInfoOpen;
export const useActiveModal = actual.useActiveModal;
export const useOpenModal = actual.useOpenModal;
export const useCloseModal = actual.useCloseModal;
export const useSetInitialized = actual.useSetInitialized;
export const useSetHydrated = actual.useSetHydrated;
export const useSetOllamaConnected = actual.useSetOllamaConnected;
