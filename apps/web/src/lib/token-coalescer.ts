'use client';

// ── rAF token coalescer ─────────────────────────────────────────────────────
// Tokens arrive at ~30-80/sec from Ollama. Without coalescing each one
// triggers a store mutation + React re-render. We buffer tokens in
// per-conversation accumulators and flush via a caller-provided bulk
// flush callback inside a single `requestAnimationFrame`, capping mutations
// at ~60/sec (vsync). `drainPendingTokenBatch()` flushes synchronously —
// called by `flushAndStop`/`stopStream` (coordination.ts) before they read
// the streaming buffer so late-arriving tokens accumulated since the last
// rAF tick are written into the store and included in the flush.

interface PendingBatch {
  text: string;
  requestId: string;
}

const pendingBatches: Map<string, PendingBatch> = new Map();
let rafId: number | null = null;

let bulkFlushFn: ((convId: string, text: string, requestId: string) => void) | null = null;

function flushPendingBatches(): void {
  rafId = null;
  if (pendingBatches.size === 0) return;
  if (!bulkFlushFn) {
    pendingBatches.clear();
    return;
  }
  for (const [convId, batch] of pendingBatches) {
    bulkFlushFn(convId, batch.text, batch.requestId);
  }
  pendingBatches.clear();
}

function scheduleFlush(): void {
  if (rafId !== null) return;
  rafId =
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flushPendingBatches) : null;
  if (rafId === null) flushPendingBatches();
}

/**
 * Registers the bulk flush function. Called once during app initialization
 * (before any tokens arrive) so the coalescer can push accumulated text
 * into the streaming store without importing the store directly.
 */
export function setBulkFlush(fn: (convId: string, text: string, requestId: string) => void): void {
  bulkFlushFn = fn;
}

/**
 * Buffers a token for the given conversation. The accumulated text is
 * flushed via the bulk flush callback at the next rAF tick.
 */
export function bufferToken(convId: string, token: string, requestId: string): void {
  const existing = pendingBatches.get(convId);
  if (existing) {
    existing.text += token;
  } else {
    pendingBatches.set(convId, { text: token, requestId });
  }
  scheduleFlush();
}

/**
 * Drains any tokens still buffered in the rAF coalescer synchronously.
 * Called by `flushAndStop`/`stopStream` before they read the streaming
 * buffer so no buffered text is lost.
 */
export function drainPendingTokenBatch(): void {
  if (rafId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(rafId);
  }
  rafId = null;
  flushPendingBatches();
}
