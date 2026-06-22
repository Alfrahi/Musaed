'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import { type OllamaModel, ModelStateSchema, DEFAULT_MODEL_STATE } from '@musaed/contracts';
import { createTauriStorage } from '@/lib/tauri-storage';
import { useUIStore } from '@/store/ui-store';

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
}

interface ModelState {
  models: OllamaModel[];
  selectedModel: string;
  pullStatus: Record<string, PullStatus>; // modelName -> status
  setModels: (models: OllamaModel[]) => void;
  setSelectedModel: (selectedModel: string) => void;
  updatePullStatus: (name: string, status: PullStatus | null) => void;
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
            console.error('Model store rehydration failed:', error);
          } else if (state) {
            const result = ModelStateSchema.safeParse({ selectedModel: state.selectedModel });
            if (!result.success) {
              console.warn(
                'Rehydrated model state failed validation, resetting to defaults',
                result.error
              );
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
