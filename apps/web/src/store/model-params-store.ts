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
 * Resolution order per field:
 *
 * 1. User override for the field if present in the model's profile.
 * 2. Model's Modelfile default from `/api/show` (for all five fields).
 *    For `numCtx` only: when the Modelfile default is absent, the model's
 *    `contextLength` from `model_info` is used as an additional fallback.
 * 3. `DEFAULT_MODEL_PARAMS` for the field.
 *
 * `numCtx` is the only field with a two-tier metadata fallback because it
 * is the only param with a model-derived `model_info` default distinct from
 * the Modelfile's `PARAMETER num_ctx` directive. The other four fall back
 * to `DEFAULT_MODEL_PARAMS` when neither the user override nor the
 * Modelfile default are available.
 *
 * When a stored `numCtx` override exceeds the current model's
 * `contextLength`, the resolved value is clamped down to `contextLength`
 * (so the value sent to Ollama never overshoots the model's actual context
 * window). The stored override is preserved verbatim by the store; only the
 * resolved value seen by callers is clamped.
 *
 * @param defaultParams Per-model sampling defaults parsed from the
 * Modelfile's `PARAMETER` directives by `cmd_ollama_validate_model`. Pass
 * `null` when the model has no Modelfile or the directives are absent.
 */
export const selectResolvedParams = (
  modelName: string,
  contextLength: number | null,
  defaultParams: ModelDefaultParams | null = null
): ModelParams => {
  const profile = useModelParamsStore.getState().profiles[modelName];
  const dpFallback = (key: 'temperature' | 'topP' | 'topK' | 'numPredict') =>
    defaultParams?.[key] ?? DEFAULT_MODEL_PARAMS[key];
  const numCtxFallback = defaultParams?.numCtx ?? contextLength ?? DEFAULT_MODEL_PARAMS.numCtx;
  if (!profile) {
    return {
      ...DEFAULT_MODEL_PARAMS,
      temperature: dpFallback('temperature'),
      topP: dpFallback('topP'),
      topK: dpFallback('topK'),
      numPredict: dpFallback('numPredict'),
      numCtx: numCtxFallback,
    };
  }
  const overrides = profile.overrides;
  const params = profile.params;
  const resolve = <K extends ModelParamKey>(k: K, fallback: number) =>
    overrides.includes(k) ? params[k] : fallback;
  const numCtxOverride = overrides.includes('numCtx') ? params.numCtx : null;
  const numCtx = clampNumCtx(numCtxOverride, contextLength, defaultParams?.numCtx ?? null);
  return {
    temperature: resolve('temperature', dpFallback('temperature')),
    topK: resolve('topK', dpFallback('topK')),
    topP: resolve('topP', dpFallback('topP')),
    numPredict: resolve('numPredict', dpFallback('numPredict')),
    numCtx,
  };
};

/**
 * Clamp a stored `numCtx` override against the model's `contextLength`.
 *
 * Resolution for `numCtx` (no user override path — callers pre-check):
 * 1. Stored user override (if valid against contextLength).
 * 2. Modelfile `PARAMETER num_ctx` default when present.
 * 3. Model's `contextLength` from `model_info`.
 * 4. `DEFAULT_MODEL_PARAMS.numCtx`.
 */
function clampNumCtx(
  override: number | null,
  contextLength: number | null,
  modelfileNumCtx: number | null
): number {
  if (override === null) {
    if (modelfileNumCtx !== null) return modelfileNumCtx;
    return contextLength ?? DEFAULT_MODEL_PARAMS.numCtx;
  }
  if (contextLength !== null && override > contextLength) return contextLength;
  return override;
}

/**
 * React hook form of `selectResolvedParams` for components that need to
 * re-render on profile changes. Returns resolved params plus the raw stored
 * override value for `numCtx` (so the panel can show a clamp hint when the
 * stored override exceeds the current model's `contextLength`).
 *
 * @param defaultParams Per-model sampling defaults parsed from the
 * Modelfile's `PARAMETER` directives by `cmd_ollama_validate_model`. Pass
 * `null` when the model has no Modelfile or the directives are absent.
 */
export interface ResolvedModelParams extends ModelParams {
  /** Stored `numCtx` override verbatim, even if it exceeds `contextLength`. */
  rawNumCtxOverride: number | null;
  /** True when the user has overridden `numCtx` and it exceeds `contextLength`. */
  numCtxClamped: boolean;
}

export const useResolvedModelParams = (
  modelName: string,
  contextLength: number | null,
  defaultParams: ModelDefaultParams | null = null
): ResolvedModelParams =>
  useModelParamsStore((state) => {
    const profile = state.profiles[modelName];
    const dpFallback = (key: 'temperature' | 'topP' | 'topK' | 'numPredict') =>
      defaultParams?.[key] ?? DEFAULT_MODEL_PARAMS[key];
    const numCtxFallback = defaultParams?.numCtx ?? contextLength ?? DEFAULT_MODEL_PARAMS.numCtx;
    if (!profile) {
      return {
        ...DEFAULT_MODEL_PARAMS,
        temperature: dpFallback('temperature'),
        topP: dpFallback('topP'),
        topK: dpFallback('topK'),
        numPredict: dpFallback('numPredict'),
        numCtx: numCtxFallback,
        rawNumCtxOverride: null,
        numCtxClamped: false,
      };
    }
    const overrides = profile.overrides;
    const params = profile.params;
    const resolve = <K extends ModelParamKey>(k: K, fallback: number) =>
      overrides.includes(k) ? params[k] : fallback;
    const numCtxOverride = overrides.includes('numCtx') ? params.numCtx : null;
    const numCtxClamped =
      numCtxOverride !== null && contextLength !== null && numCtxOverride > contextLength;
    return {
      temperature: resolve('temperature', dpFallback('temperature')),
      topK: resolve('topK', dpFallback('topK')),
      topP: resolve('topP', dpFallback('topP')),
      numPredict: resolve('numPredict', dpFallback('numPredict')),
      numCtx: clampNumCtx(numCtxOverride, contextLength, defaultParams?.numCtx ?? null),
      rawNumCtxOverride: numCtxOverride,
      numCtxClamped,
    };
  }, shallow);

/** Selector hook for whether a given param on a model is currently overridden. */
export const useIsParamOverridden = (modelName: string, key: ModelParamKey): boolean =>
  useModelParamsStore(
    (state) => !!state.profiles[modelName] && state.profiles[modelName].overrides.includes(key)
  );
