import type { IndexProgress, ProjectStatus, RagProject } from '@musaed/contracts';

export type ProjectStatusPatch = Pick<RagProject, 'status' | 'retryAttempts' | 'lastError'>;

/**
 * Derive the next project status, retry-attempt count, and last-error string
 * from an incoming indexing-progress event together with the existing project
 * record.
 *
 * The retry detection relies on a sentinel convention: a `discoveringFiles`
 * phase with `current > 0` and `total === 3` signals a retry attempt, in
 * which case `current` carries the retry count. Any other `discoveringFiles`
 * event resets the counter to 0 (a fresh indexing operation).
 *
 * Pure: reads only its two inputs and produces a patch — no I/O, no store
 * mutation. Lives in `src/lib/` so both `src/store/` and `src/features/rag/`
 * can depend on it without crossing the feature boundary (STANDARDS.md §9
 * forbids store → feature imports).
 */
export function deriveProjectStatus(
  progress: IndexProgress | null,
  existing: RagProject
): ProjectStatusPatch {
  const retryAttempts =
    progress?.phase === 'discoveringFiles' && progress.current > 0 && progress.total === 3
      ? progress.current // This indicates a retry attempt
      : progress?.phase === 'discoveringFiles'
        ? 0 // New indexing operation
        : (existing.retryAttempts ?? 0);

  const lastError =
    progress?.phase === 'failed' && progress.message
      ? progress.message
      : (existing.lastError ?? null);

  const status: ProjectStatus = progress
    ? progress.phase === 'completed'
      ? 'ready'
      : progress.phase === 'failed'
        ? 'error'
        : 'indexing'
    : existing.status;

  return { status, retryAttempts, lastError };
}
