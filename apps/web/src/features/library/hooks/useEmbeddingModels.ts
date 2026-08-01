'use client';

import { useEffect, useState } from 'react';
import { ollamaApi } from '@/lib/ipc';
import { useOllamaUrl } from '@/store';

/**
 * Fetches the list of available Ollama models for use as embedding models.
 * Returns an empty array while loading or on error — the consumer handles
 * the fallback (free-text input for the model name).
 */
export function useEmbeddingModels() {
  const [embeddingModels, setEmbeddingModels] = useState<{ name: string }[]>([]);
  const ollamaUrl = useOllamaUrl();

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const data = await ollamaApi.getModels(ollamaUrl);
        if (data) setEmbeddingModels(data);
      } catch {
        // IPC layer handles error sanitization
      }
    };
    fetchModels();
  }, [ollamaUrl]);

  return embeddingModels;
}
