'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  ModelParamProfileSchema,
  type ModelParamKey,
  type ModelParamProfile,
  type ModelParams,
  type ModelDefaultParams,
  DEFAULT_MODEL_PARAMS,
} from '@musaed/contracts';
import { createTauriStorage } from '@/lib/tauri-storage';
import { useUIStore } from '@/store/ui-store';
import { logger } from '@/lib/logger';
import { resolveModelParams } from '@/lib/token-budget';
import { traceStoreMutation } from '@/lib/store-tracing';

/**
 * Migration registry for model-params-store. Add handlers as schema evolves.
 * Version 1: Initial schema with profiles map and per-model overrides.
 */
const MODEL_PARAMS_MIGRATIONS: Record<number, (data: unknown) => unknown> = {
  1: (data: unknown) => {
    const persisted =
      typeof data === 'object' && data !== null ? (data as { profiles?: unknown }) : {};
    return { profiles: persisted.profiles ?? {} };
  },
};

interface ModelParamsState {
  /** Per-model profiles keyed by model name. */
  profiles: Record<string, ModelParamProfile>;
  /** Set a single sampling param for a model. Marks it as overridden. */
  setParam: (modelName: string, key: ModelParamKey, value: number) => void;
  /** Clear the override for one param, re-deriving it from defaults/metadata. */
  resetParam: (modelName: string, key: ModelParamKey) => void;
  /** Clear all overrides for a model. */
  resetAll: (modelName: string) => void;
  /** Drop profiles whose model names are not in `modelNames`. Called on fetch. */
  prune: (modelNames: string[]) => void;
}

export const useModelParamsStore = createWithEqualityFn<ModelParamsState>()(
  persist(
    (set) => ({
      profiles: {},
      setParam: (modelName, key, value) =>
        set((state) => {
          const existing = state.profiles[modelName];
          const profile: ModelParamProfile = existing
            ? {
                modelName,
                params: { ...existing.params, [key]: value },
                overrides: existing.overrides.includes(key)
                  ? existing.overrides
                  : [...existing.overrides, key],
              }
            : {
                modelName,
                params: { ...DEFAULT_MODEL_PARAMS, [key]: value },
                overrides: [key],
              };
          traceStoreMutation({
            feature: 'model-params',
            action: 'setParam',
            level: 'INFO',
            message: `setParam ${key} for ${modelName}`,
            context: { modelName, key, value },
            throttleMs: 0,
          });
          return { profiles: { ...state.profiles, [modelName]: profile } };
        }),
      resetParam: (modelName, key) =>
        set((state) => {
          const existing = state.profiles[modelName];
          if (!existing || !existing.overrides.includes(key)) return state;
          const overrides = existing.overrides.filter((k) => k !== key);
          const params = { ...existing.params, [key]: DEFAULT_MODEL_PARAMS[key] };
          return {
            profiles: { ...state.profiles, [modelName]: { ...existing, params, overrides } },
          };
        }),
      resetAll: (modelName) =>
        set((state) => {
          const existing = state.profiles[modelName];
          if (!existing) return state;
          return {
            profiles: {
              ...state.profiles,
              [modelName]: { ...existing, params: { ...DEFAULT_MODEL_PARAMS }, overrides: [] },
            },
          };
        }),
      prune: (modelNames) =>
        set((state) => {
          const keep = new Set(modelNames);
          const next: Record<string, ModelParamProfile> = {};
          for (const [name, profile] of Object.entries(state.profiles)) {
            if (keep.has(name)) next[name] = profile;
          }
          // Skip update if nothing changed (referential equality for selectors).
          if (Object.keys(next).length === Object.keys(state.profiles).length) return state;
          return { profiles: next };
        }),
    }),
    {
      name: 'musaed-model-params-storage',
      storage: createJSONStorage(() =>
        createTauriStorage('model-params.json', 1, MODEL_PARAMS_MIGRATIONS)
      ),
      version: 1,
      migrate: (_persistedState, _version) => {
        // Migrations are handled by createTauriStorage (canonical path).
        // Safety-net default only.
        if (!_persistedState || typeof _persistedState !== 'object') {
          return { profiles: {} };
        }
        const persistedRoot = _persistedState as { profiles?: Record<string, unknown> };
        return { profiles: persistedRoot.profiles ?? {} };
      },
      skipHydration: true,
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            logger.error('Model params store rehydration failed:', { error: String(error) });
          } else if (state) {
            // Validate each profile entry against schema; drop failures.
            const profiles = state.profiles ?? {};
            const validated: Record<string, ModelParamProfile> = {};
            for (const [name, profile] of Object.entries(profiles)) {
              const result = ModelParamProfileSchema.safeParse(profile);
              if (result.success) validated[name] = result.data;
              else logger.warn('Dropping invalid model param profile on rehydrate', { name });
            }
            state.profiles = validated;
          }
          useUIStore.getState().onStoreRehydrated();
        };
      },
      partialize: (state) => ({ profiles: state.profiles }),
    }
  ),
  shallow
);

/**
 * Resolve the effective sampling params for a model given its `context_length`
 * and Modelfile sampling defaults (or nulls when metadata is unavailable).
 * Thin adapter over the single shared resolver in
 * `@/lib/token-budget#resolveModelParams`; see there for the precedence
 * ladder and clamping semantics.
 *
 * @param defaultParams Per-model sampling defaults parsed from the
 * Modelfile's `PARAMETER` directives by `cmd_ollama_validate_model`. Pass
 * `null` when the model has no Modelfile or the directives are absent.
 */
export const selectResolvedParams = (
  modelName: string,
  contextLength: number | null,
  defaultParams: ModelDefaultParams | null = null
): ModelParams =>
  resolveModelParams(useModelParamsStore.getState().profiles[modelName], {
    contextWindow: contextLength,
    modelfileDefaults: defaultParams,
  }).params;

/**
 * React hook form of `selectResolvedParams` for components that need to
 * re-render on profile changes. Returns the resolved params flattened plus
 * the raw stored override value for `numCtx` (so the panel can show a clamp
 * hint when resolution had to reduce the stored value).
 *
 * @param defaultParams Per-model sampling defaults parsed from the
 * Modelfile's `PARAMETER` directives by `cmd_ollama_validate_model`. Pass
 * `null` when the model has no Modelfile or the directives are absent.
 */
export const useResolvedModelParams = (
  modelName: string,
  contextLength: number | null,
  defaultParams: ModelDefaultParams | null = null
) =>
  useModelParamsStore((state) => {
    const resolved = resolveModelParams(state.profiles[modelName], {
      contextWindow: contextLength,
      modelfileDefaults: defaultParams,
    });
    return {
      ...resolved.params,
      rawNumCtxOverride: resolved.rawNumCtxOverride,
      numCtxClamped: resolved.numCtxClamped,
    };
  }, shallow);

/** Selector hook for whether a given param on a model is currently overridden. */
export const useIsParamOverridden = (modelName: string, key: ModelParamKey): boolean =>
  useModelParamsStore(
    (state) => !!state.profiles[modelName] && state.profiles[modelName].overrides.includes(key)
  );
