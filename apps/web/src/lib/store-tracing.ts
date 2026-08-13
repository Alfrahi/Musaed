'use client';

import { type TraceEntryInput } from '@musaed/contracts';
import { traceApi } from '@/lib/ipc';
import { generateTraceId } from '@/lib/trace-id';

/**
 * Store-mutation observability helper (STANDARDS.md §14).
 *
 * Routes structured trace entries through the same `traceApi.append`
 * pipeline used by the IPC latency layer, so store churn surfaces in
 * the Diagnostics UI alongside IPC budget violations. Every store
 * mutation is a non-fatal probe: emit-and-forget, errors swallowed.
 */

const TRACE_THROTTLE_MS_DEFAULT = 5_000;
const TOKEN_TRACE_EVERY_N = 16;

const lastTraceAt: Map<string, number> = new Map();
const tokenCounters: Map<string, number> = new Map();

interface StoreTraceOptions {
  feature: string;
  action: string;
  level: TraceEntryInput['level'];
  message: string;
  context?: Record<string, unknown>;
  /** Throttle window in ms. Set to 0 to always emit. */
  throttleMs?: number;
  /**
   * Suffix appended to the throttle cache key (`feature:action` + suffix).
   * Pass a stable per-target id (e.g. conversationId) when the same
   * action fires concurrently across multiple targets and each target
   * should be throttled independently.
   */
  throttleKeySuffix?: string;
}

/**
 * Emits a structured trace entry describing a store mutation.
 * Throttled per `feature:action[:suffix]` key so a churning mutation
 * does not flood the trace store.
 */
export function traceStoreMutation({
  feature,
  action,
  level,
  message,
  context,
  throttleMs = TRACE_THROTTLE_MS_DEFAULT,
  throttleKeySuffix,
}: StoreTraceOptions): void {
  const key = throttleKeySuffix
    ? `${feature}:${action}:${throttleKeySuffix}`
    : `${feature}:${action}`;
  if (throttleMs > 0) {
    const now = Date.now();
    const lastAt = lastTraceAt.get(key);
    if (lastAt !== undefined && now - lastAt < throttleMs) {
      return;
    }
    lastTraceAt.set(key, now);
  }

  const input: TraceEntryInput = {
    traceId: generateTraceId(),
    feature,
    action,
    level,
    message,
    source: 'frontend',
    context,
  };

  traceApi.append(input).catch(() => {
    // Trace emission must never break store mutations.
  });
}

/**
 * Per-stream token counter for the streaming appendToken hot path.
 * Emits a DEBUG trace entry every Nth token per conversation, instead
 * of relying on a pure time window — fast streams would otherwise
 * burst and slow streams would emit on every token.
 *
 * Returns true when a trace was emitted this call (useful for tests).
 */
export function traceAppendToken(conversationId: string, contentLen: number): boolean {
  const count = (tokenCounters.get(conversationId) ?? 0) + 1;
  tokenCounters.set(conversationId, count);
  if (count % TOKEN_TRACE_EVERY_N !== 0) {
    return false;
  }
  traceStoreMutation({
    feature: 'streaming',
    action: 'appendToken',
    level: 'DEBUG',
    message: `appendToken #${count} for ${conversationId}`,
    context: { conversationId, contentLen, tokenIdx: count },
    throttleMs: 0,
  });
  return true;
}

/**
 * Resets the per-stream token counter for a conversation. Called on
 * flush/clear so a restarted stream begins emitting from the first
 * 1/N boundary rather than continuing an old counter.
 */
export function resetTokenCounter(conversationId: string): void {
  tokenCounters.delete(conversationId);
}

/**
 * Clears all throttle windows and token counters. Test-only seam.
 */
export function resetStoreTracing(): void {
  lastTraceAt.clear();
  tokenCounters.clear();
}

/** Test-only inspection helper. */
export const __internal = {
  TOKEN_TRACE_EVERY_N,
  TRACE_THROTTLE_MS_DEFAULT,
};
