'use client';

import { useEffect, useState } from 'react';
import { ollamaApi } from '@/lib/ipc';
import { useSelectedModel } from '@/store/model-store';
import { useOllamaUrl } from '@/store/settings-store';

export interface ModelContextWindowInfo {
  /** The resolved context window size for the current model. */
  contextWindow: number | null;
  /** True while the context window is being fetched. */
  loading: boolean;
  /** Error message if the fetch failed; null otherwise. */
  error: string | null;
}

/**
 * Fetches the current model's `context_length` from the Ollama server
 * via `cmd_ollama_validate_model` (which calls `/api/show`). The value
 * is architecture-prefixed in the response (e.g. `llama.context_length`),
 * extracted dynamically on the Rust side.
 *
 * Falls back to `null` when the model is invalid, the server is
 * unreachable, or `context_length` is absent — callers (e.g.
 * `useTokenUsage`) should fall back to `numCtx` from settings in that case.
 */
export function useModelContextWindow(): ModelContextWindowInfo {
  const selectedModel = useSelectedModel();
  const baseUrl = useOllamaUrl();
  const [contextWindow, setContextWindow] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedModel || !baseUrl) {
      setContextWindow(null);
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
        if (result && result.isValid && result.contextLength) {
          setContextWindow(result.contextLength);
        } else {
          setContextWindow(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setContextWindow(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedModel, baseUrl]);

  return { contextWindow, loading, error };
}
