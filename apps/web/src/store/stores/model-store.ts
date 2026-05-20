'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { type OllamaModel } from '@musaed/contracts';
// Persistence moved to Rust backend – this store is now in‑memory only

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
  (set) => ({
    models: [],
    selectedModel: '',
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
  shallow
);
