import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));
// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
// Mock stores
vi.mock('@/store/ui-store', () => ({
  useUIStore: {
    getState: vi.fn(() => ({ onStoreRehydrated: vi.fn() })),
    setState: vi.fn(),
  },
}));

import {
  useModelStore,
  useModels,
  useSelectedModel,
  selectSelectedModel,
  selectModelPullStatus,
  selectIsModelPulling,
} from './model-store';
import { DEFAULT_MODEL_STATE } from '@musaed/contracts';

describe('Model Store', () => {
  beforeEach(() => {
    // Reset store state
    useModelStore.setState({
      models: [],
      selectedModel: DEFAULT_MODEL_STATE.selectedModel,
      pullStatus: {},
    });
  });

  describe('selectors', () => {
    it('selectSelectedModel should return selected model or null', () => {
      useModelStore.setState({
        models: [
          { name: 'llama3', size: 1000, digest: 'abc', details: {} },
          { name: 'mistral', size: 2000, digest: 'def', details: {} },
        ],
        selectedModel: 'llama3',
      });

      const state = useModelStore.getState();
      const result = selectSelectedModel(state);
      expect(result).toEqual({ name: 'llama3', size: 1000, digest: 'abc', details: {} });
    });

    it('selectSelectedModel should return null when model not found', () => {
      useModelStore.setState({
        models: [{ name: 'llama3', size: 1000, digest: 'abc', details: {} }],
        selectedModel: 'nonexistent',
      });

      const state = useModelStore.getState();
      const result = selectSelectedModel(state);
      expect(result).toBeNull();
    });

    it('selectModelPullStatus should return pull status for a model', () => {
      useModelStore.setState({
        pullStatus: {
          llama3: { status: 'downloading', progress: 50 },
        },
      });

      const state = useModelStore.getState();
      const selector = selectModelPullStatus('llama3');
      expect(selector(state)).toEqual({ status: 'downloading', progress: 50 });
    });

    it('selectModelPullStatus should return null when no status', () => {
      useModelStore.setState({ pullStatus: {} });

      const state = useModelStore.getState();
      const selector = selectModelPullStatus('llama3');
      expect(selector(state)).toBeNull();
    });

    it('selectIsModelPulling should return true when pulling', () => {
      useModelStore.setState({
        pullStatus: { llama3: { status: 'downloading', progress: 50 } },
      });

      const state = useModelStore.getState();
      const selector = selectIsModelPulling('llama3');
      expect(selector(state)).toBe(true);
    });

    it('selectIsModelPulling should return false when not pulling', () => {
      useModelStore.setState({ pullStatus: {} });

      const state = useModelStore.getState();
      const selector = selectIsModelPulling('llama3');
      expect(selector(state)).toBe(false);
    });
  });

  describe('actions', () => {
    it('setModels should update models list', () => {
      const models = [
        { name: 'llama3', size: 1000, digest: 'abc', details: {} },
        { name: 'mistral', size: 2000, digest: 'def', details: {} },
      ];

      useModelStore.getState().setModels(models);
      expect(useModelStore.getState().models).toEqual(models);
    });

    it('setSelectedModel should update selected model', () => {
      useModelStore.getState().setSelectedModel('mistral');
      expect(useModelStore.getState().selectedModel).toBe('mistral');
    });

    it('updatePullStatus should add status for a model', () => {
      useModelStore.getState().updatePullStatus('llama3', { status: 'downloading', progress: 50 });
      expect(useModelStore.getState().pullStatus['llama3']).toEqual({
        status: 'downloading',
        progress: 50,
      });
    });

    it('updatePullStatus should remove status when null', () => {
      useModelStore.setState({
        pullStatus: { llama3: { status: 'downloading', progress: 50 } },
      });

      useModelStore.getState().updatePullStatus('llama3', null);
      expect(useModelStore.getState().pullStatus['llama3']).toBeUndefined();
    });
  });

  describe('hooks', () => {
    it('useModels should return models', () => {
      const testModels = [{ name: 'llama3', size: 1000, digest: 'abc', details: {} }];
      useModelStore.setState({ models: testModels });

      const { result } = renderHook(() => useModels());
      expect(result.current).toEqual(testModels);
    });

    it('useSelectedModel should return selected model name', () => {
      useModelStore.setState({ selectedModel: 'mistral' });

      const { result } = renderHook(() => useSelectedModel());
      expect(result.current).toBe('mistral');
    });
  });
});
