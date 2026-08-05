import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));
// Mock @tauri-apps/api/core so the storage layer can be loaded.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
// Mock ui-store so the persist onRehydrate callback can call onStoreRehydrated.
vi.mock('@/store/ui-store', () => ({
  useUIStore: {
    getState: vi.fn(() => ({ onStoreRehydrated: vi.fn() })),
    setState: vi.fn(),
  },
}));

import {
  useModelParamsStore,
  selectResolvedParams,
  useResolvedModelParams,
  useIsParamOverridden,
} from './model-params-store';
import { DEFAULT_MODEL_PARAMS } from '@musaed/contracts';

describe('model-params-store', () => {
  beforeEach(() => {
    useModelParamsStore.setState({ profiles: {} });
  });

  describe('setParam', () => {
    it('creates a new profile when none exists', () => {
      const { result } = renderHook(() => useModelParamsStore());
      act(() => {
        result.current.setParam('llama3.1:8b', 'temperature', 0.3);
      });
      const profile = useModelParamsStore.getState().profiles['llama3.1:8b'];
      expect(profile.params.temperature).toBe(0.3);
      expect(profile.overrides).toContain('temperature');
    });

    it('updates an existing profile without duplicating overrides', () => {
      useModelParamsStore.setState({
        profiles: {
          'llama3.1:8b': {
            modelName: 'llama3.1:8b',
            params: { ...DEFAULT_MODEL_PARAMS, temperature: 0.3 },
            overrides: ['temperature'],
          },
        },
      });
      const { result } = renderHook(() => useModelParamsStore());
      act(() => {
        result.current.setParam('llama3.1:8b', 'temperature', 0.5);
      });
      const profile = useModelParamsStore.getState().profiles['llama3.1:8b'];
      expect(profile.params.temperature).toBe(0.5);
      expect(profile.overrides.filter((k) => k === 'temperature')).toHaveLength(1);
    });
  });

  describe('selectResolvedParams', () => {
    it('returns DEFAULT_MODEL_PARAMS when model has no profile', () => {
      const params = selectResolvedParams('unknown-model', null);
      expect(params).toEqual(DEFAULT_MODEL_PARAMS);
    });

    it('uses model context_length for numCtx when not overridden', () => {
      const params = selectResolvedParams('llama3.1:8b', 131072);
      expect(params.numCtx).toBe(131072);
    });

    it('prefers user override over model metadata for numCtx', () => {
      useModelParamsStore.setState({
        profiles: {
          'llama3.1:8b': {
            modelName: 'llama3.1:8b',
            params: { ...DEFAULT_MODEL_PARAMS, numCtx: 8192 },
            overrides: ['numCtx'],
          },
        },
      });
      const params = selectResolvedParams('llama3.1:8b', 131072);
      expect(params.numCtx).toBe(8192);
    });

    it('falls back to DEFAULT_MODEL_PARAMS.numCtx when neither override nor metadata', () => {
      const params = selectResolvedParams('unknown-model', null);
      expect(params.numCtx).toBe(DEFAULT_MODEL_PARAMS.numCtx);
    });

    it('clamps numCtx override to context_length when override exceeds it', () => {
      useModelParamsStore.setState({
        profiles: {
          'gemma2:2b': {
            modelName: 'gemma2:2b',
            params: { ...DEFAULT_MODEL_PARAMS, numCtx: 32768 },
            overrides: ['numCtx'],
          },
        },
      });
      // Stored override is 32768 but model's context_length is 8192.
      const params = selectResolvedParams('gemma2:2b', 8192);
      expect(params.numCtx).toBe(8192);
      // The stored override is preserved in the store (not mutated).
      expect(useModelParamsStore.getState().profiles['gemma2:2b'].params.numCtx).toBe(32768);
    });

    it('preserves numCtx override when it is within context_length', () => {
      useModelParamsStore.setState({
        profiles: {
          'llama3.1:8b': {
            modelName: 'llama3.1:8b',
            params: { ...DEFAULT_MODEL_PARAMS, numCtx: 4096 },
            overrides: ['numCtx'],
          },
        },
      });
      const params = selectResolvedParams('llama3.1:8b', 131072);
      expect(params.numCtx).toBe(4096);
    });

    // --- defaultParams fallback tier (Modelfile `PARAMETER` defaults) ---

    it('uses defaultParams for non-overridden fields when no profile exists', () => {
      const defaultParams = {
        temperature: 0.5,
        topP: 0.85,
        topK: 64,
        numCtx: 16384,
        numPredict: -1,
      };
      const params = selectResolvedParams('unknown-model', null, defaultParams);
      expect(params.temperature).toBe(0.5);
      expect(params.topP).toBe(0.85);
      expect(params.topK).toBe(64);
      expect(params.numCtx).toBe(16384);
      expect(params.numPredict).toBe(-1);
    });

    it('prefers user override over defaultParams for non-numCtx fields', () => {
      useModelParamsStore.setState({
        profiles: {
          'llama3.1:8b': {
            modelName: 'llama3.1:8b',
            params: { ...DEFAULT_MODEL_PARAMS, temperature: 0.3 },
            overrides: ['temperature'],
          },
        },
      });
      const defaultParams = {
        temperature: 0.5,
        topP: 0.85,
        topK: 64,
        numCtx: 16384,
        numPredict: -1,
      };
      const params = selectResolvedParams('llama3.1:8b', null, defaultParams);
      expect(params.temperature).toBe(0.3); // override wins
      expect(params.topP).toBe(0.85); // defaultParams fallback
      expect(params.topK).toBe(64); // defaultParams fallback
      expect(params.numPredict).toBe(-1); // defaultParams fallback
    });

    it('uses defaultParams.numCtx over contextLength when no override', () => {
      const defaultParams = {
        temperature: 0.5,
        topP: 0.85,
        topK: 64,
        numCtx: 16384,
        numPredict: -1,
      };
      // contextLength is 8192 — defaultParams.numCtx (16384) should win.
      const params = selectResolvedParams('unknown-model', 8192, defaultParams);
      expect(params.numCtx).toBe(16384);
    });

    it('falls back to contextLength for numCtx when defaultParams.numCtx is null', () => {
      const defaultParams = {
        temperature: 0.5,
        topP: null,
        topK: null,
        numCtx: null,
        numPredict: null,
      };
      const params = selectResolvedParams('unknown-model', 131072, defaultParams);
      expect(params.numCtx).toBe(131072); // contextLength fallback
      expect(params.temperature).toBe(0.5); // defaultParams
      expect(params.topP).toBe(DEFAULT_MODEL_PARAMS.topP); // final fallback
    });

    it('falls back to DEFAULT_MODEL_PARAMS for fields when defaultParams is null', () => {
      const params = selectResolvedParams('unknown-model', null, null);
      expect(params).toEqual(DEFAULT_MODEL_PARAMS);
    });

    it('falls back to DEFAULT_MODEL_PARAMS when defaultParams field is null', () => {
      const defaultParams = {
        temperature: null,
        topP: null,
        topK: null,
        numCtx: null,
        numPredict: null,
      };
      const params = selectResolvedParams('unknown-model', null, defaultParams);
      expect(params.temperature).toBe(DEFAULT_MODEL_PARAMS.temperature);
      expect(params.topP).toBe(DEFAULT_MODEL_PARAMS.topP);
      expect(params.topK).toBe(DEFAULT_MODEL_PARAMS.topK);
      expect(params.numPredict).toBe(DEFAULT_MODEL_PARAMS.numPredict);
      expect(params.numCtx).toBe(DEFAULT_MODEL_PARAMS.numCtx);
    });

    it('clamps numCtx override to context_length even when defaultParams has numCtx', () => {
      useModelParamsStore.setState({
        profiles: {
          'gemma2:2b': {
            modelName: 'gemma2:2b',
            params: { ...DEFAULT_MODEL_PARAMS, numCtx: 32768 },
            overrides: ['numCtx'],
          },
        },
      });
      const defaultParams = {
        temperature: 0.5,
        topP: 0.85,
        topK: 64,
        numCtx: 16384,
        numPredict: -1,
      };
      // Override is 32768, model context_length is 8192 → clamped to 8192.
      // defaultParams.numCtx would be used only if no override existed.
      const params = selectResolvedParams('gemma2:2b', 8192, defaultParams);
      expect(params.numCtx).toBe(8192);
    });

    it('uses defaultParams.numCtx for non-overridden numCtx within context_length', () => {
      useModelParamsStore.setState({
        profiles: {
          'llama3.1:8b': {
            modelName: 'llama3.1:8b',
            params: { ...DEFAULT_MODEL_PARAMS, temperature: 0.3 },
            overrides: ['temperature'],
          },
        },
      });
      const defaultParams = {
        temperature: 0.5,
        topP: 0.85,
        topK: 64,
        numCtx: 4096,
        numPredict: -1,
      };
      // numCtx not overridden; modelfile default 4096 is within contextLength 8192.
      const params = selectResolvedParams('llama3.1:8b', 8192, defaultParams);
      expect(params.numCtx).toBe(4096);
    });
  });

  describe('resetParam', () => {
    it('removes the override for a single field and restores default', () => {
      useModelParamsStore.setState({
        profiles: {
          'llama3.1:8b': {
            modelName: 'llama3.1:8b',
            params: { ...DEFAULT_MODEL_PARAMS, temperature: 0.3 },
            overrides: ['temperature'],
          },
        },
      });
      const { result } = renderHook(() => useModelParamsStore());
      act(() => {
        result.current.resetParam('llama3.1:8b', 'temperature');
      });
      const profile = useModelParamsStore.getState().profiles['llama3.1:8b'];
      expect(profile.overrides).not.toContain('temperature');
      expect(profile.params.temperature).toBe(DEFAULT_MODEL_PARAMS.temperature);
    });

    it('is a no-op when the field is not overridden', () => {
      useModelParamsStore.setState({
        profiles: {
          'llama3.1:8b': {
            modelName: 'llama3.1:8b',
            params: { ...DEFAULT_MODEL_PARAMS },
            overrides: [],
          },
        },
      });
      const before = useModelParamsStore.getState().profiles['llama3.1:8b'];
      const { result } = renderHook(() => useModelParamsStore());
      act(() => {
        result.current.resetParam('llama3.1:8b', 'temperature');
      });
      expect(useModelParamsStore.getState().profiles['llama3.1:8b']).toBe(before);
    });
  });

  describe('resetAll', () => {
    it('clears all overrides and restores all defaults', () => {
      useModelParamsStore.setState({
        profiles: {
          'llama3.1:8b': {
            modelName: 'llama3.1:8b',
            params: { ...DEFAULT_MODEL_PARAMS, temperature: 0.3, topK: 80 },
            overrides: ['temperature', 'topK'],
          },
        },
      });
      const { result } = renderHook(() => useModelParamsStore());
      act(() => {
        result.current.resetAll('llama3.1:8b');
      });
      const profile = useModelParamsStore.getState().profiles['llama3.1:8b'];
      expect(profile.overrides).toEqual([]);
      expect(profile.params).toEqual(DEFAULT_MODEL_PARAMS);
    });
  });

  describe('prune', () => {
    it('drops profiles not in the keep-list', () => {
      useModelParamsStore.setState({
        profiles: {
          'llama3.1:8b': {
            modelName: 'llama3.1:8b',
            params: { ...DEFAULT_MODEL_PARAMS },
            overrides: [],
          },
          'gemma2:2b': {
            modelName: 'gemma2:2b',
            params: { ...DEFAULT_MODEL_PARAMS },
            overrides: [],
          },
        },
      });
      const { result } = renderHook(() => useModelParamsStore());
      act(() => {
        result.current.prune(['llama3.1:8b']);
      });
      const profiles = useModelParamsStore.getState().profiles;
      expect(Object.keys(profiles)).toEqual(['llama3.1:8b']);
    });

    it('is a no-op when nothing would be pruned (returns same state reference)', () => {
      useModelParamsStore.setState({
        profiles: {
          'llama3.1:8b': {
            modelName: 'llama3.1:8b',
            params: { ...DEFAULT_MODEL_PARAMS },
            overrides: [],
          },
        },
      });
      const before = useModelParamsStore.getState();
      const { result } = renderHook(() => useModelParamsStore());
      act(() => {
        result.current.prune(['llama3.1:8b']);
      });
      expect(useModelParamsStore.getState()).toBe(before);
    });
  });

  describe('useResolvedModelParams — clamp-above-max', () => {
    it('clamps displayed numCtx to context_length but preserves raw override', () => {
      useModelParamsStore.setState({
        profiles: {
          'gemma2:2b': {
            modelName: 'gemma2:2b',
            params: { ...DEFAULT_MODEL_PARAMS, numCtx: 32768 },
            overrides: ['numCtx'],
          },
        },
      });
      const { result } = renderHook(() => useResolvedModelParams('gemma2:2b', 8192));
      expect(result.current.numCtx).toBe(8192);
      expect(result.current.rawNumCtxOverride).toBe(32768);
      expect(result.current.numCtxClamped).toBe(true);
    });

    it('does not flag clamp when override is within model max', () => {
      useModelParamsStore.setState({
        profiles: {
          'gemma2:2b': {
            modelName: 'gemma2:2b',
            params: { ...DEFAULT_MODEL_PARAMS, numCtx: 4096 },
            overrides: ['numCtx'],
          },
        },
      });
      const { result } = renderHook(() => useResolvedModelParams('gemma2:2b', 8192));
      expect(result.current.numCtx).toBe(4096);
      expect(result.current.numCtxClamped).toBe(false);
    });
  });

  describe('useResolvedModelParams — defaultParams fallback', () => {
    it('uses defaultParams for non-overridden fields without a profile', () => {
      const defaultParams = {
        temperature: 0.6,
        topP: 0.88,
        topK: 50,
        numCtx: 4096,
        numPredict: 100,
      };
      const { result } = renderHook(() =>
        useResolvedModelParams('unknown-model', null, defaultParams)
      );
      expect(result.current.temperature).toBe(0.6);
      expect(result.current.topP).toBe(0.88);
      expect(result.current.topK).toBe(50);
      expect(result.current.numCtx).toBe(4096);
      expect(result.current.numPredict).toBe(100);
      expect(result.current.rawNumCtxOverride).toBeNull();
      expect(result.current.numCtxClamped).toBe(false);
    });

    it('uses defaultParams.numCtx over contextLength when no override', () => {
      const defaultParams = {
        temperature: null,
        topP: null,
        topK: null,
        numCtx: 16384,
        numPredict: null,
      };
      const { result } = renderHook(() =>
        useResolvedModelParams('unknown-model', 8192, defaultParams)
      );
      expect(result.current.numCtx).toBe(16384);
    });

    it('prefers override over defaultParams but keeps defaultParams for other fields', () => {
      useModelParamsStore.setState({
        profiles: {
          'llama3.1:8b': {
            modelName: 'llama3.1:8b',
            params: { ...DEFAULT_MODEL_PARAMS, temperature: 0.2 },
            overrides: ['temperature'],
          },
        },
      });
      const defaultParams = {
        temperature: 0.6,
        topP: 0.88,
        topK: 50,
        numCtx: 4096,
        numPredict: 100,
      };
      const { result } = renderHook(() =>
        useResolvedModelParams('llama3.1:8b', null, defaultParams)
      );
      expect(result.current.temperature).toBe(0.2);
      expect(result.current.topP).toBe(0.88);
      expect(result.current.numCtx).toBe(4096);
    });
  });

  describe('useIsParamOverridden', () => {
    it('returns true for overridden keys, false otherwise', () => {
      useModelParamsStore.setState({
        profiles: {
          'llama3.1:8b': {
            modelName: 'llama3.1:8b',
            params: { ...DEFAULT_MODEL_PARAMS, temperature: 0.3 },
            overrides: ['temperature'],
          },
        },
      });
      const { result: tempResult } = renderHook(() =>
        useIsParamOverridden('llama3.1:8b', 'temperature')
      );
      const { result: topKResult } = renderHook(() => useIsParamOverridden('llama3.1:8b', 'topK'));
      expect(tempResult.current).toBe(true);
      expect(topKResult.current).toBe(false);
    });
  });
});
