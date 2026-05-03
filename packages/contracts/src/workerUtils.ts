// workerUtils.ts
// Persistent Web Worker pool for off-main-thread text processing.
// The worker blob is built from shared constants to prevent regex drift.

import {
  THINKING_REGEX_SOURCE,
  stripThinkingBlocks,
} from './redactedThinking';

// ── Public result type ──────────────────────────────────────────────

export interface StripResult {
  content: string;
  method: 'worker' | 'sync';
}

// ── Worker protocol ─────────────────────────────────────────────────

interface WorkerRequest {
  type: 'stripRedactedThinkingBlocks';
  payload: { content: string };
  /** Correlation id so responses can be matched to callers. */
  id: number;
}

interface WorkerResponse {
  id: number;
  result?: unknown;
  error?: string;
}

// ── Pool implementation ─────────────────────────────────────────────

const POOL_SIZE = 2;

/** Lazily-initialised persistent workers. */
const workers: Worker[] = [];
let workersCreated = false;

/** Per-worker availability flag. */
const available: boolean[] = [];

/** Queue of pending requests waiting for a free worker. */
interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  request: WorkerRequest;
}
const pendingQueue: Pending[] = [];

/** Monotonic request id for correlating responses. */
let nextId = 0;

/** Callbacks awaiting a response, keyed by request id. */
const inflight = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();

/**
 * Builds the self-contained worker code blob.
 *
 * The regex pattern is injected from `THINKING_REGEX_SOURCE`
 * so the worker always uses the same logic as the synchronous path —
 * no duplicated patterns.
 */
function buildWorkerCode(): string {
  return `
    self.onmessage = (event) => {
      const { type, payload, id } = event.data;
      try {
        let result;
        switch (type) {
          case 'stripRedactedThinkingBlocks':
            result = payload.content.replace(new RegExp(${JSON.stringify(THINKING_REGEX_SOURCE)}, 'gi'), '').trim();
            break;
          default:
            throw new Error('Unknown computation type: ' + type);
        }
        self.postMessage({ id, result });
      } catch (error) {
        self.postMessage({ id, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    };
  `;
}

/** Create a single persistent worker and wire up its message handler. */
function spawnWorker(index: number): Worker {
  const blob = new Blob([buildWorkerCode()], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);

  worker.onmessage = (event: MessageEvent) => {
    const data = event.data as WorkerResponse;
    const callback = inflight.get(data.id);
    if (callback) {
      inflight.delete(data.id);
      if (data.error) {
        callback.reject(new Error(data.error));
      } else {
        callback.resolve(data.result);
      }
    }
    // Mark this worker as available and drain the queue.
    available[index] = true;
    drainQueue();
  };

  worker.onerror = (event: ErrorEvent) => {
    // Reject all inflight requests for this worker (best-effort).
    for (const [id, cb] of inflight) {
      cb.reject(new Error(event.message));
      inflight.delete(id);
    }
    available[index] = true;
    drainQueue();
  };

  available[index] = true;
  return worker;
}

/** Ensure the pool is initialised (lazy, once). */
function ensurePool(): void {
  if (workersCreated) return;
  workersCreated = true;
  for (let i = 0; i < POOL_SIZE; i++) {
    try {
      workers.push(spawnWorker(i));
    } catch {
      // Worker creation can fail in environments that don't support them.
      // That's fine — callers fall back to the sync path.
      available.push(false);
    }
  }
}

/** Send a request to the first available worker, or queue it. */
function dispatch(request: WorkerRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const freeIndex = available.findIndex(Boolean);
    if (freeIndex !== -1 && workers[freeIndex]) {
      available[freeIndex] = false;
      inflight.set(request.id, { resolve, reject });
      workers[freeIndex].postMessage(request);
    } else {
      pendingQueue.push({ resolve, reject, request });
    }
  });
}

/** Process the next pending request if a worker is free. */
function drainQueue(): void {
  if (pendingQueue.length === 0) return;
  const freeIndex = available.findIndex(Boolean);
  if (freeIndex === -1 || !workers[freeIndex]) return;
  const next = pendingQueue.shift()!;
  available[freeIndex] = false;
  inflight.set(next.request.id, { resolve: next.resolve, reject: next.reject });
  workers[freeIndex].postMessage(next.request);
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Strips thinking blocks from content using the persistent
 * Web Worker pool. Falls back to the synchronous implementation if
 * the pool is unavailable.
 *
 * @param content The content to process.
 * @returns A tagged result indicating the processing method used.
 */
export async function stripThinkingBlocksWorker(content: string): Promise<StripResult> {
  ensurePool();

  const hasAvailableWorker = available.some(Boolean) && workers.length > 0;

  if (!hasAvailableWorker && pendingQueue.length >= POOL_SIZE) {
    // All workers busy and queue full — fall back to sync immediately.
    return { content: stripThinkingBlocks(content), method: 'sync' };
  }

  try {
    const id = nextId++;
    const result = await dispatch({
      type: 'stripRedactedThinkingBlocks',
      payload: { content },
      id,
    });
    return { content: result as string, method: 'worker' };
  } catch {
    // Worker error — fall back to the identical synchronous path.
    return { content: stripThinkingBlocks(content), method: 'sync' };
  }
}
