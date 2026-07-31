/**
 * IPC latency tracking subsystem.
 *
 * Extracted from `ipc.ts` (Finding 12) to keep the IPC bridge focused on
 * command routing. This module owns the data structures, counters, and
 * query functions for IPC performance monitoring.
 *
 * The mutation functions (`recordIpcLatency`, `dispatchIpcViolationTrace`)
 * remain in `ipc.ts` because they depend on `traceApi` which is defined there.
 */

import type { IpcCallStat, IpcStats } from '@musaed/contracts';

// Re-export for backward compatibility
export type { IpcCallStat, IpcStats };
export type { IpcStats as LatencyStats };

/**
 * Aggregated IPC performance statistics for monitoring and CI enforcement.
 * Exposed globally so tests and observability tooling can assert on budget compliance.
 *
 * @example
 * // In a test after performing IPC calls:
 * expect(ipcStats.violationCount).toBe(0);
 * // Or check specific commands:
 * const violations = ipcStats.calls.filter(c => c.status === 'violation');
 * expect(violations).toHaveLength(0);
 */
export const ipcStats: IpcStats = {
  /** Total IPC calls made */
  callCount: 0,

  /** Total IPC calls that exceeded their latency budget */
  violationCount: 0,

  /** Per-call records: command → { latencyMs, budgetMs, status }.
   *  Useful for debugging and per-command analytics. */
  calls: [],
};

/**
 * Maximum number of violation entries retained in `ipcViolationHistory`.
 * Prevents unbounded growth in long-running sessions.
 */
export const IPC_VIOLATION_HISTORY_MAX = 200;

/**
 * Maximum number of per-call records retained in `ipcStats.calls`.
 * Prevents unbounded growth in long-running sessions; once exceeded,
 * the oldest entry is dropped (FIFO). Larger than `IPC_VIOLATION_HISTORY_MAX`
 * because `calls` retains both ok and violation entries for per-command
 * analytics.
 */
export const IPC_CALLS_HISTORY_MAX = 500;

/**
 * Throttle window (ms) for trace emission per over-budget command.
 * Once a violation is dispatched, subsequent violations of the same
 * command within this window are dropped to avoid trace-store spam.
 */
export const IPC_VIOLATION_TRACE_THROTTLE_MS = 30_000;

/**
 * Structured record of an IPC latency violation that was dispatched
 * to the trace pipeline. The `traceId` matches the value written to
 * the trace store so the Diagnostics UI can correlate the entry in
 * `LogViewer` with the in-process `ipcStats` counter.
 */
export interface IpcViolationRecord {
  /** UUID identifying this violation trace (matches trace store entry). */
  traceId: string;
  /** ISO timestamp at moment of detection. */
  timestamp: string;
  /** Command name that overran its budget. */
  command: string;
  /** Observed latency in milliseconds. */
  latencyMs: number;
  /** Configured budget in milliseconds. */
  budgetMs: number;
  /** Percentage overage (rounded). */
  overagePct: number;
}

/**
 * Rolling window of structured IPC violations. Surfaced to the
 * Diagnostics UI via `getIpcViolations()` and `getIpcViolationsSince()`
 * so users can correlate trace entries with IPC perf counters.
 */
export const ipcViolationHistory: IpcViolationRecord[] = [];

/**
 * Last dispatch timestamp (ms) per command, used to enforce the
 * per-command throttle window for trace emission.
 */
export const lastViolationTraceAt: Map<string, number> = new Map();

/**
 * Subscribers to mutation of `ipcViolationHistory`. Used by
 * `subscribeIpcViolations()` so long-lived UI surfaces can re-render
 * without polling. Returns an unsubscribe function.
 */
const ipcViolationSubscribers: Set<() => void> = new Set();

export function notifyIpcViolationSubscribers(): void {
  for (const subscriber of ipcViolationSubscribers) {
    try {
      subscriber();
    } catch {
      // Subscriber errors must not break the IPC pipeline.
    }
  }
}

/**
 * Returns a deep copy snapshot of the current IPC stats. Useful for
 * long-lived subscribers (e.g. Diagnostics UI) that want to re-render
 * without mutating the live counters.
 */
export function snapshotIpcStats(): IpcStats {
  return {
    callCount: ipcStats.callCount,
    violationCount: ipcStats.violationCount,
    calls: [...ipcStats.calls],
  };
}

/**
 * Resets all IPC perf counters. Intended for tests and for the
 * Diagnostics UI's "clear counters" affordance.
 */
export function resetIpcStats(): void {
  ipcStats.callCount = 0;
  ipcStats.violationCount = 0;
  ipcStats.calls.length = 0;
}

/**
 * Clears all IPC latency tracking state: perf counters, violation
 * history, and the per-command throttle window. Used by tests and
 * the Diagnostics UI "clear counters" affordance.
 */
export function resetIpcViolations(): void {
  ipcStats.callCount = 0;
  ipcStats.violationCount = 0;
  ipcStats.calls.length = 0;
  ipcViolationHistory.length = 0;
  lastViolationTraceAt.clear();
  notifyIpcViolationSubscribers();
}

/**
 * Returns a copy of the rolling IPC violation history (most-recent
 * first is not guaranteed — entries are in insertion order). The
 * list is bounded at `IPC_VIOLATION_HISTORY_MAX`.
 */
export function getIpcViolations(): IpcViolationRecord[] {
  return [...ipcViolationHistory];
}

/**
 * Returns violations whose `traceId` differs from the supplied
 * marker — i.e., entries that arrived *after* the marker. Pass the
 * last-seen `traceId` from a prior call to obtain an incremental
 * update. Returns the full history when the marker is not found.
 *
 * The Diagnostics UI uses this to re-render only when new violations
 * arrive, avoiding polling churn.
 */
export function getIpcViolationsSince(traceId: string): IpcViolationRecord[] {
  const idx = ipcViolationHistory.findIndex((entry) => entry.traceId === traceId);
  if (idx === -1) return [...ipcViolationHistory];
  return ipcViolationHistory.slice(idx + 1);
}

/**
 * Subscribes to mutation of the IPC violation history. Returns an
 * unsubscribe function. Long-lived UI surfaces (LogViewer,
 * DiagnosticsSettings) use this to re-render without polling.
 */
export function subscribeIpcViolations(listener: () => void): () => void {
  ipcViolationSubscribers.add(listener);
  return () => {
    ipcViolationSubscribers.delete(listener);
  };
}
