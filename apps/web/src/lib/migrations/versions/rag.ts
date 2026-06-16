/**
 * RAG Store Migrations
 *
 * Defines migrations for the RAG store schema evolution.
 * Handles both Zustand state migrations and coordinates with backend SQLite migrations.
 */

import type { RagState } from '../../../store/stores/rag-store';
import { RagProjectSchema, type RagProject, SearchResultSchema } from '@musaed/contracts';
import { z } from 'zod';

/**
 * RAG state wrapper schema with metadata.
 */
export const RagStateWrapperSchema = z.object({
  projects: z.record(z.string(), RagProjectSchema),
  projectIds: z.array(z.string()),
  activeProjectId: z.string().nullable(),
  searchResults: z.array(SearchResultSchema).optional().default([]),
  isSearching: z.boolean().optional().default(false),
  metadata: z
    .object({
      version: z.number(),
      lastMigratedAt: z.string().optional(),
      migrationPath: z.array(z.number()).optional(),
    })
    .optional(),
});

/**
 * Migration v1 → v2 (2026-06-15)
 * Adds status field tracking from backend to sync project state properly.
 * Ensures projectIds array stays in sync with projects map.
 *
 * Change: Enhance projectIds normalization, add status sync hints
 * Why: Prevent desync between projects map and projectIds array (observed in prod)
 * Rollback: Safe (metadata-only changes)
 */
export const migrateRagToV2 = (data: unknown): Partial<RagState> => {
  const wrapped = RagStateWrapperSchema.parse(data);

  // Ensure all projects have valid status (migrate from legacy if needed)
  const migratedProjects: Record<string, RagProject> = {};
  for (const [id, project] of Object.entries(wrapped.projects)) {
    migratedProjects[id] = {
      ...project,
      status: project.status ?? 'idle', // Default status if missing
    };
  }

  // Normalize projectIds to match actual project keys
  const normalizedIds = Object.keys(migratedProjects);

  return {
    projects: migratedProjects,
    projectIds: normalizedIds,
    activeProjectId: wrapped.activeProjectId,
    searchResults: wrapped.searchResults ?? [],
    isSearching: wrapped.isSearching ?? false,
  };
};

/**
 * Rollback v2 → v1
 * Removes status normalization (field remains in data, just skips migration logic).
 */
export const rollbackRagToV1 = (data: RagState): RagState => {
  // No destructive changes - rollback is identity
  // Status field can safely remain
  return data;
};

/**
 * Validation function for RAG state.
 */
export const validateRag = (data: unknown): Partial<RagState> => {
  const parsed = RagStateWrapperSchema.parse(data);
  return {
    projects: parsed.projects,
    projectIds: parsed.projectIds,
    activeProjectId: parsed.activeProjectId,
    searchResults: parsed.searchResults ?? [],
    isSearching: parsed.isSearching ?? false,
  };
};

/**
 * RAG migration registry.
 */
export const ragMigrations = {
  2: migrateRagToV2,
};

/**
 * Bidirectional migrations for rollback support.
 */
export const ragBidirectionalMigrations = {
  2: {
    migrate: migrateRagToV2,
    rollback: rollbackRagToV1,
    isRollbackable: true,
    description: 'Add status field sync and projectIds normalization',
  },
};

/**
 * Current RAG store schema version.
 */
export const RAG_STORE_VERSION = 2;
