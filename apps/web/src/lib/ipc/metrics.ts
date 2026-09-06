import { callInternal } from './transport';

/**
 * Metrics API — rolling performance snapshot.
 *
 * Each call drains the backend's recorded samples, so callers get a
 * "since last snapshot" window. Declared as a SHARED_COMMAND so any
 * settings/diagnostics surface can poll it.
 *
 * @see STANDARDS.md §5  IPC System
 */
export const metricsApi = {
  /**
   * Returns mean/p95/p99 latency stats for chat (time-to-first-token),
   * RAG search, and RAG indexing, then clears the recorded samples.
   *
   * @returns The snapshot, or `null` when running outside Tauri.
   */
  snapshot: () => callInternal('cmd_metrics_snapshot', {}),
};
