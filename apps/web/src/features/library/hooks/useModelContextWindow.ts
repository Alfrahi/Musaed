'use client';

import { useEffect, useState } from 'react';
import { ollamaApi } from '@/lib/ipc';
import { useSelectedModel } from '@/store/model-store';
import { useOllamaUrl } from '@/store/settings-store';
import type { ModelDefaultParams } from '@musaed/contracts';

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
 * Fetches the current model's `context_length` and per-model sampling
 * defaults from the Ollama server via `cmd_ollama_validate_model` (which
 * calls `/api/show`). The `contextWindow` value is architecture-prefixed
 * (e.g. `llama.context_length`), extracted on the Rust side. The
 * `defaultParams` are parsed from the Modelfile's `PARAMETER` directives;
 * null when the model has no Modelfile or those directives are absent.
 *
 * Falls back to `null` for both `contextWindow` and `defaultParams` when
 * the model is invalid or the server is unreachable —
 * `selectResolvedParams` / `useResolvedModelParams` then fall back to
 * `DEFAULT_MODEL_PARAMS` per field.
 */
export function useModelContextWindow(): ModelContextWindowInfo {
  const selectedModel = useSelectedModel();
  const baseUrl = useOllamaUrl();
  const [contextWindow, setContextWindow] = useState<number | null>(null);
  const [defaultParams, setDefaultParams] = useState<ModelDefaultParams | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedModel || !baseUrl) {
      setContextWindow(null);
      setDefaultParams(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    ollamaApi
      .validateModel(baseUrl, selectedModel)
      .then((result) => {
        if (cancelled) return;
        if (result && result.isValid) {
          setContextWindow(result.contextLength ?? null);
          setDefaultParams(result.defaultParams ?? null);
        } else {
          setContextWindow(null);
          setDefaultParams(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setContextWindow(null);
        setDefaultParams(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedModel, baseUrl]);

  return { contextWindow, defaultParams, loading, error };
}
