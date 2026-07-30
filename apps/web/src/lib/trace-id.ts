/**
 * Generates a UUID v4 for trace IDs. Falls back to a deterministic
 * value in environments without `crypto.randomUUID` (e.g., legacy
 * test runners), keeping the trace pipeline non-fatal.
 *
 * Deduplicated from `ipc.ts` and `store-tracing.ts` (Finding 5).
 */
export function generateTraceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
