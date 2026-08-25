'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSelectedModel } from '@/store/model-store';
import { useOllamaUrl } from '@/store/settings-store';
import type { ModelDefaultParams } from '@musaed/contracts';
import {
  subscribeModelCapabilities,
  getCachedModelCapabilities,
  fetchModelCapabilities,
} from './model-capabilities-cache';

export interface ModelContextWindowInfo {
  /** The resolved context window size for the current model. */
  contextWindow: number | null;
  /** Per-model sampling defaults from the Modelfile's `PARAMETER` directives. */
  defaultParams: ModelDefaultParams | null;
  /** True while the context window is being fetched. */
  loading: boolean;
  /** Error message if the fetch failed; null otherwise. */
  error: string | null;
}

/**
 * Exposes the current model's `context_length` and Modelfile sampling
 * defaults as a thin selector over the feature-wide capabilities cache.
 * All mounted consumers share one `cmd_ollama_validate_model` call per
 * (baseUrl, model); switching back to a known model serves the cached
 * facts synchronously instead of racing through a null window.
 *
 * Falls back to `null` for both `contextWindow` and `defaultParams` when
 * the model is invalid or the server is unreachable — resolution then
 * falls back to `DEFAULT_MODEL_PARAMS` per field (see
 * `@/lib/token-budget#resolveModelParams`).
 */
export function useModelContextWindow(): ModelContextWindowInfo {
  const selectedModel = useSelectedModel();
  const baseUrl = useOllamaUrl();
  const hasKey = Boolean(selectedModel && baseUrl);
  const [fetchFailed, setFetchFailed] = useState(false);

  const caps = useSyncExternalStore(
    subscribeModelCapabilities,
    () => (hasKey ? getCachedModelCapabilities(baseUrl, selectedModel) : null),
    () => null
  );

  useEffect(() => {
    setFetchFailed(false);
    if (!selectedModel || !baseUrl) return;
    let cancelled = false;
    fetchModelCapabilities(baseUrl, selectedModel).catch(() => {
      if (!cancelled) setFetchFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, selectedModel]);

  return {
    contextWindow: caps?.contextWindow ?? null,
    defaultParams: caps?.modelfileDefaults ?? null,
    loading: hasKey && caps === null && !fetchFailed,
    error: null,
  };
}
