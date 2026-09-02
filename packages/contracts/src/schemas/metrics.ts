import { z } from 'zod';

/**
 * Performance metrics contracts.
 *
 * `cmd_metrics_snapshot` returns a rolling-window snapshot of latencies
 * recorded in-process (chat time-to-first-token, RAG search, RAG indexing)
 * and drains the samples on each call.
 *
 * Mirrors `src-tauri/src/metrics/mod.rs` — the Rust structs use
 * `#[serde(rename_all = "camelCase")]`, so the wire shape matches exactly.
 *
 * @see STANDARDS.md §5  IPC System
 * @see STANDARDS.md §10 IPC + Rust contract alignment
 */

export const MetricStatsSchema = z.object({
  count: z.number().int().nonnegative(),
  meanMs: z.number(),
  p95Ms: z.number(),
  p99Ms: z.number(),
});

export const MetricsSnapshotSchema = z.object({
  chatLatency: MetricStatsSchema,
  searchLatency: MetricStatsSchema,
  ragIndexDuration: MetricStatsSchema,
});

export type MetricStats = z.infer<typeof MetricStatsSchema>;
export type MetricsSnapshot = z.infer<typeof MetricsSnapshotSchema>;
