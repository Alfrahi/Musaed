import type { ModelCapabilities } from '@musaed/contracts';
import { ollamaApi } from '@/lib/ipc';

/**
 * In-memory, session-scoped cache of per-model capability facts
 * (`/api/show` via `cmd_ollama_validate_model`), keyed by (baseUrl, model).
 *
 * Purpose: every consumer (useChatSend, useTokenUsage, ModelParamsPanel)
 * previously ran its own `validateModel` IPC call into component-local
 * state — N calls per model switch and a null-window race until each
 * resolved. The cache guarantees one IPC call per key, shared synchronously
 * once resolved. Entries are refetchable facts, never persisted.
 */

interface CacheEntry {
  caps: ModelCapabilities;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ModelCapabilities>>();
const listeners = new Set<() => void>();

const keyOf = (baseUrl: string, model: string): string => `${baseUrl}::${model}`;

function emit(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to cache mutations (for `useSyncExternalStore`). */
export function subscribeModelCapabilities(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read the cached snapshot without triggering a fetch. */
export function getCachedModelCapabilities(
  baseUrl: string,
  model: string
): ModelCapabilities | null {
  return cache.get(keyOf(baseUrl, model))?.caps ?? null;
}

/** Fetch (or join an in-flight fetch of) capabilities for one key. */
export function fetchModelCapabilities(baseUrl: string, model: string): Promise<ModelCapabilities> {
  const key = keyOf(baseUrl, model);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached.caps);

  const pending = inflight.get(key);
  if (pending) return pending;

  const request = ollamaApi
    .validateModel(baseUrl, model)
    .then((result) => {
      const caps: ModelCapabilities =
        result && result.isValid
          ? {
              contextWindow: result.contextLength ?? null,
              modelfileDefaults: result.defaultParams ?? null,
            }
          : { contextWindow: null, modelfileDefaults: null };
      cache.set(key, { caps });
      return caps;
    })
    .finally(() => {
      inflight.delete(key);
      emit();
    });

  // Rejections must not poison the cache — drop the entry so the next
  // caller retries once the server is reachable again.
  request.catch(() => {
    if (cache.get(key) === undefined) return;
    cache.delete(key);
    emit();
  });

  inflight.set(key, request);
  return request;
}

/** Empty the cache entirely (used on test setup and model-list refresh). */
export function clearModelCapabilitiesCache(): void {
  cache.clear();
  emit();
}
