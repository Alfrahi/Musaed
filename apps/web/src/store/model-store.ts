'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import { type OllamaModel, ModelStateSchema, DEFAULT_MODEL_STATE } from '@musaed/contracts';
import { createTauriStorage } from '@/lib/tauri-storage';
import { useUIStore } from '@/store/ui-store';
import { logger } from '@/lib/logger';

// Migration for model state: ensure schema integrity on rehydration
const MODEL_MIGRATIONS: Record<number, (data: unknown) => unknown> = {
  1: (data: unknown) => {
    const persisted =
      typeof data === 'object' && data !== null ? (data as Partial<{ selectedModel: string }>) : {};
    return { ...DEFAULT_MODEL_STATE, ...persisted };
  },
};

interface PullStatus {
  status: string;
  progress?: number;
  /** Bytes downloaded so far (from Ollama pull-progress events). */
  completed?: number;
  /** Total bytes to download (from Ollama pull-progress events). */
  total?: number;
}

interface ModelState {
  models: OllamaModel[];
  selectedModel: string;
  pullStatus: Record<string, PullStatus>; // modelName -> status
  fetchError: string | null;
  setModels: (models: OllamaModel[]) => void;
  setSelectedModel: (selectedModel: string) => void;
  updatePullStatus: (name: string, status: PullStatus | null) => void;
  setFetchError: (error: string | null) => void;
}

// Selectors for the model store
export const selectSelectedModel = (state: ModelState) =>
  state.models.find((model) => model.name === state.selectedModel) || null;

export const selectModelPullStatus = (modelName: string) => (state: ModelState) =>
  state.pullStatus[modelName] || null;

export const selectIsModelPulling = (modelName: string) => (state: ModelState) =>
  !!state.pullStatus[modelName];

export const useModelStore = createWithEqualityFn<ModelState>()(
  persist(
    (set) => ({
      models: [],
      selectedModel: DEFAULT_MODEL_STATE.selectedModel,
      pullStatus: {},
      fetchError: null,
      setModels: (models) => set({ models }),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
      updatePullStatus: (name, status) =>
        set((state) => {
          const next = { ...state.pullStatus };
          if (status === null) {
            delete next[name];
          } else {
            next[name] = status;
          }
          return { pullStatus: next };
        }),
      setFetchError: (error) => set({ fetchError: error }),
    }),
    {
      name: 'musaed-model-storage',
      storage: createJSONStorage(() => createTauriStorage('model-state.json', 1, MODEL_MIGRATIONS)),
      version: 1,
      migrate: (persistedState, _version) => {
        const migration = MODEL_MIGRATIONS[1];
        if (migration && typeof persistedState === 'object' && persistedState !== null) {
          return migration(persistedState);
        }
        const persisted =
          typeof persistedState === 'object'
            ? (persistedState as Partial<{ selectedModel: string }>)
            : {};
        return { ...DEFAULT_MODEL_STATE, ...persisted };
      },
      skipHydration: true,
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            logger.error('Model store rehydration failed:', { error: String(error) });
          } else if (state) {
            const result = ModelStateSchema.safeParse({ selectedModel: state.selectedModel });
            if (!result.success) {
              logger.warn('Rehydrated model state failed validation, resetting to defaults', {
                error: result.error,
              });
              state.selectedModel = DEFAULT_MODEL_STATE.selectedModel;
            }
          }
          useUIStore.getState().onStoreRehydrated();
        };
      },
      partialize: (state) => ({
        selectedModel: state.selectedModel,
      }),
    }
  ),
  shallow
);

// Selector hooks for external access (e.g., settings feature)
export const useModels = () => useModelStore((state) => state.models);
export const useSelectedModel = () => useModelStore((state) => state.selectedModel);
export const useModelFetchError = () => useModelStore((state) => state.fetchError);
export const useSetModelFetchError = () => useModelStore((state) => state.setFetchError);
