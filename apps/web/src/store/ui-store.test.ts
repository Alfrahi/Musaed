import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useUIStore,
  selectIsAnyModalOpen,
  selectHasError,
  useIsStreaming,
  useIsInitialized,
  useIsHydrated,
  useIsOllamaConnected,
  useUIError,
  useIsSettingsOpen,
  useIsLibraryOpen,
  useIsInfoOpen,
  useActiveModal,
  useOpenModal,
  useCloseModal,
  useSetUIError,
} from './ui-store';

// Mock Tauri environment
beforeEach(() => {
  (window as any).__TAURI_INTERNALS__ = { invoke: () => undefined };
});

describe('UI Store Complete', () => {
  beforeEach(() => {
    // Reset store state before each test
    useUIStore.setState({
      isStreaming: false,
      isInitialized: false,
      isHydrated: false,
      isOllamaConnected: false,
      errorMessage: null,
      activeModal: null,
      _pendingRehydrations: 0,
    });
  });

  describe('state initialization', () => {
    it('should initialize with default values', () => {
      const state = useUIStore.getState();
      expect(state.isStreaming).toBe(false);
      expect(state.isInitialized).toBe(false);
      expect(state.isHydrated).toBe(false);
      expect(state.isOllamaConnected).toBe(false);
      expect(state.errorMessage).toBeNull();
      expect(state.activeModal).toBeNull();
      expect(state._pendingRehydrations).toBe(0);
    });
  });

  describe('streaming state', () => {
    it('should set streaming state', () => {
      act(() => {
        useUIStore.getState().setStreaming(true);
      });
      expect(useUIStore.getState().isStreaming).toBe(true);
    });

    it('should clear streaming state', () => {
      act(() => {
        useUIStore.getState().setStreaming(true);
        useUIStore.getState().setStreaming(false);
      });
      expect(useUIStore.getState().isStreaming).toBe(false);
    });
  });

  describe('initialization state', () => {
    it('should set initialized state', () => {
      act(() => {
        useUIStore.getState().setInitialized(true);
      });
      expect(useUIStore.getState().isInitialized).toBe(true);
    });
  });

  describe('hydration state', () => {
    it('should set hydrated state directly', () => {
      act(() => {
        useUIStore.getState().setHydrated(true);
      });
      expect(useUIStore.getState().isHydrated).toBe(true);
    });

    it('should track pending rehydrations', () => {
      act(() => {
        useUIStore.getState().setPendingRehydrations(3);
      });
      expect(useUIStore.getState()._pendingRehydrations).toBe(3);
    });

    it('should decrement pending rehydrations and set hydrated when <= 0', () => {
      act(() => {
        useUIStore.getState().setPendingRehydrations(2);
        useUIStore.getState().onStoreRehydrated();
        useUIStore.getState().onStoreRehydrated();
      });
      expect(useUIStore.getState()._pendingRehydrations).toBe(0);
      expect(useUIStore.getState().isHydrated).toBe(true);
    });
  });

  describe('Ollama connection state', () => {
    it('should set Ollama connected state', () => {
      act(() => {
        useUIStore.getState().setOllamaConnected(true);
      });
      expect(useUIStore.getState().isOllamaConnected).toBe(true);
    });
  });

  describe('error state', () => {
    it('should set error message', () => {
      act(() => {
        useUIStore.getState().setErrorMessage('Test error');
      });
      expect(useUIStore.getState().errorMessage).toBe('Test error');
    });

    it('should clear error message', () => {
      act(() => {
        useUIStore.getState().setErrorMessage('Test error');
        useUIStore.getState().setErrorMessage(null);
      });
      expect(useUIStore.getState().errorMessage).toBeNull();
    });
  });

  describe('modal state', () => {
    const MODAL_KINDS = [
      'settings',
      'library',
      'info',
      'cheatsheet',
      'commandPalette',
      'search',
    ] as const;

    it.each(MODAL_KINDS)('openModal(%s) sets activeModal to that kind', (kind) => {
      act(() => {
        useUIStore.getState().openModal(kind);
      });
      expect(useUIStore.getState().activeModal).toBe(kind);
    });

    it('closeModal sets activeModal to null', () => {
      act(() => {
        useUIStore.getState().openModal('settings');
        useUIStore.getState().closeModal();
      });
      expect(useUIStore.getState().activeModal).toBeNull();
    });

    it('openModal replaces the previous modal', () => {
      act(() => {
        useUIStore.getState().openModal('library');
        useUIStore.getState().openModal('settings');
      });
      expect(useUIStore.getState().activeModal).toBe('settings');
    });
  });

  describe('selectors', () => {
    it('selectIsAnyModalOpen should return true when any modal is open', () => {
      act(() => {
        useUIStore.getState().openModal('settings');
      });
      expect(selectIsAnyModalOpen(useUIStore.getState())).toBe(true);
    });

    it('selectIsAnyModalOpen should return false when all modals closed', () => {
      expect(selectIsAnyModalOpen(useUIStore.getState())).toBe(false);
    });

    it('selectHasError should return true when error exists', () => {
      act(() => {
        useUIStore.getState().setErrorMessage('Error');
      });
      expect(selectHasError(useUIStore.getState())).toBe(true);
    });

    it('selectHasError should return false when no error', () => {
      act(() => {
        useUIStore.getState().setErrorMessage(null);
      });
      expect(selectHasError(useUIStore.getState())).toBe(false);
    });
  });

  describe('hooks', () => {
    it('useIsStreaming should return streaming state', () => {
      const { result } = renderHook(() => useIsStreaming());
      act(() => {
        useUIStore.getState().setStreaming(true);
      });
      expect(result.current).toBe(true);
    });

    it('useIsInitialized should return initialized state', () => {
      const { result } = renderHook(() => useIsInitialized());
      act(() => {
        useUIStore.getState().setInitialized(true);
      });
      expect(result.current).toBe(true);
    });

    it('useIsHydrated should return hydrated state', () => {
      const { result } = renderHook(() => useIsHydrated());
      act(() => {
        useUIStore.getState().setHydrated(true);
      });
      expect(result.current).toBe(true);
    });

    it('useIsOllamaConnected should return connection state', () => {
      const { result } = renderHook(() => useIsOllamaConnected());
      act(() => {
        useUIStore.getState().setOllamaConnected(true);
      });
      expect(result.current).toBe(true);
    });

    it('useUIError should return error message', () => {
      const { result } = renderHook(() => useUIError());
      act(() => {
        useUIStore.getState().setErrorMessage('Test error');
      });
      expect(result.current).toBe('Test error');
    });

    it('useIsSettingsOpen should return true when settings modal is active', () => {
      const { result } = renderHook(() => useIsSettingsOpen());
      act(() => {
        useUIStore.getState().openModal('settings');
      });
      expect(result.current).toBe(true);
    });

    it('useIsLibraryOpen should return true when library modal is active', () => {
      const { result } = renderHook(() => useIsLibraryOpen());
      act(() => {
        useUIStore.getState().openModal('library');
      });
      expect(result.current).toBe(true);
    });

    it('useIsInfoOpen should return true when info modal is active', () => {
      const { result } = renderHook(() => useIsInfoOpen());
      act(() => {
        useUIStore.getState().openModal('info');
      });
      expect(result.current).toBe(true);
    });

    it('useActiveModal should return the active modal kind', () => {
      const { result } = renderHook(() => useActiveModal());
      act(() => {
        useUIStore.getState().openModal('cheatsheet');
      });
      expect(result.current).toBe('cheatsheet');
    });

    it('useOpenModal should return the openModal function', () => {
      const { result } = renderHook(() => useOpenModal());
      act(() => {
        result.current('search');
      });
      expect(useUIStore.getState().activeModal).toBe('search');
    });

    it('useCloseModal should return the closeModal function', () => {
      const { result } = renderHook(() => useCloseModal());
      act(() => {
        useUIStore.getState().openModal('settings');
        result.current();
      });
      expect(useUIStore.getState().activeModal).toBeNull();
    });
  });

  describe('setter hooks', () => {
    it('useSetUIError should return setter function', () => {
      const { result } = renderHook(() => useSetUIError());
      act(() => {
        result.current('Error from hook');
      });
      expect(useUIStore.getState().errorMessage).toBe('Error from hook');
    });
  });
});
