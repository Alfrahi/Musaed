/**
 * System tray contracts.
 *
 * Defines the response payload for `cmd_tray_get_background_status` — the
 * IPC command that lets the frontend (and the tray close handler) query
 * whether any background work (chat streams, model pulls, RAG indexing) is
 * active so the app can decide between minimize-to-tray and normal exit.
 *
 * @see STANDARDS.md §5  IPC System
 * @see STANDARDS.md §10 IPC + Rust contract alignment
 */

import { z } from 'zod';

/**
 * The kind of background operation tracked by the tray module.
 *
 * Mirrors the three abort-handle maps in `src-tauri/src/shared.rs`:
 * `ABORT_HANDLES` (chat), `PULL_ABORT_HANDLES` (model download),
 * `RAG_INDEX_ABORT_HANDLES` (RAG indexing).
 */
export const BackgroundTaskKindSchema = z.enum(['chat', 'modelPull', 'ragIndex']);
export type BackgroundTaskKind = z.infer<typeof BackgroundTaskKindSchema>;

/**
 * Status of a single active background task.
 */
export const BackgroundTaskStatusSchema = z
  .object({
    kind: BackgroundTaskKindSchema,
    /**
     * The number of active operations of this kind.
     * Always ≥ 1 when present in the response array.
     */
    count: z.number().int().min(0),
  })
  .strict();

export type BackgroundTaskStatus = z.infer<typeof BackgroundTaskStatusSchema>;

/**
 * Response for `cmd_tray_get_background_status`.
 *
 * `tasks` is an array of active background task kinds with their counts.
 * When the array is empty, no background work is running and the app is
 * safe to exit normally. When non-empty, the tray tooltip is updated and
 * window close is intercepted to minimize-to-tray instead.
 */
export const BackgroundTasksResponseSchema = z
  .object({
    tasks: z.array(BackgroundTaskStatusSchema),
    /**
     * True when any background task is active (convenience flag so the
     * frontend does not need to iterate the array).
     */
    hasActiveTasks: z.boolean(),
  })
  .strict();

export type BackgroundTasksResponse = z.infer<typeof BackgroundTasksResponseSchema>;
