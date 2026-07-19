/**
 * RAG Store Migrations
 *
 * Defines migrations for the RAG store schema evolution.
 * Handles both Zustand state migrations and coordinates with backend SQLite migrations.
 */

import {
  RagProjectSchema,
  type RagProject,
  SearchResultSchema,
  type SearchResult,
} from '@musaed/contracts';
import { z } from 'zod';

/**
 * Partial schema for v3 projects (includes retry fields).
 */
const RagProjectV3Schema = RagProjectSchema.extend({
  retryAttempts: z.number().optional().default(0),
  lastError: z.string().nullable().optional(),
});

/**
 * RAG state wrapper schema with metadata.
 */
export const RagStateWrapperSchema = z.object({
  projects: z.record(z.string(), RagProjectV3Schema),
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
 * Partial schema for v1 projects (before migration to v2).
 * Allows missing fields that will be added during migration.
 */
const RagProjectV1Schema = RagProjectSchema.partial().extend({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  embeddingModel: z.string(),
  ignorePatterns: z.array(z.string()),
});

/**
 * Partial schema for v1 data (before migration).
 */
const RagStateV1Schema = z
  .object({
    projects: z.record(z.string(), RagProjectV1Schema),
    projectIds: z.array(z.string()),
    activeProjectId: z.string().nullable(),
  })
  .passthrough();

/**
 * RAG state shape for migration purposes (avoids circular import).
 */

export interface RagStateShape {
  projects: Record<string, RagProject>;
  projectIds: string[];
  activeProjectId: string | null;
  searchResults: SearchResult[];
  isSearching: boolean;
}

/**
 * Migration v1 → v2 (2026-06-15)
 * Adds status field tracking from backend to sync project state properly.
 * Ensures projectIds array stays in sync with projects map.
 *
 * Change: Enhance projectIds normalization, add status sync hints
 * Why: Prevent desync between projects map and projectIds array (observed in prod)
 * Rollback: Safe (metadata-only changes)
 */
export const migrateRagToV2 = (data: unknown): Partial<RagStateShape> => {
  // Use v1 schema to allow partial data, then transform to v2
  const parsed = RagStateV1Schema.parse(data);

  // Ensure all projects have all required fields and status
  const migratedProjects = {} as Record<string, RagProject>;
  for (const [id, project] of Object.entries(parsed.projects)) {
    migratedProjects[id] = {
      id: project.id,
      name: project.name,
      path: project.path,
      embeddingModel: project.embeddingModel,
      ignorePatterns: project.ignorePatterns ?? [],
      createdAt: project.createdAt ?? new Date().toISOString(),
      updatedAt: project.updatedAt ?? new Date().toISOString(),
      indexedAt: project.indexedAt ?? null,
      fileCount: project.fileCount ?? 0,
      chunkCount: project.chunkCount ?? 0,
      totalBytes: project.totalBytes ?? 0,
      status: project.status ?? 'idle',
      retryAttempts: project.retryAttempts ?? 0,
      lastError: project.lastError ?? null,
    };
  }

  // Normalize projectIds to match actual project keys
  const normalizedIds = Object.keys(migratedProjects);

  const parsedRecord = parsed as unknown as {
    searchResults?: SearchResult[];
    isSearching?: boolean;
  };

  return {
    projects: migratedProjects,
    projectIds: normalizedIds,
    activeProjectId: parsed.activeProjectId,
    searchResults: parsedRecord.searchResults ?? [],
    isSearching: parsedRecord.isSearching ?? false,
  };
};

/**
 * Rollback v2 → v1
 * Removes status normalization (field remains in data, just skips migration logic).
 */
export const rollbackRagToV1 = (data: RagStateShape): RagStateShape => {
  // No destructive changes - rollback is identity
  // Status field can safely remain
  return data;
};

/**
 * Validation function for RAG state.
 */
export const validateRag = (data: unknown): Partial<RagStateShape> => {
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
 * Migration v2 → v3 (2026-07-19)
 * Adds retryAttempts and lastError fields to track indexing retry state.
 *
 * If the input data already includes these fields (i.e., it's already at v3),
 * the migration is a no‑op and returns the data unchanged.
 */
export const migrateRagToV3 = (data: unknown): Partial<RagStateShape> => {
  // Detect if data already includes retry fields (already at v3)
  if (typeof data === 'object' && data !== null && 'projects' in data) {
    const projects = (data as { projects?: Record<string, unknown> }).projects;
    if (projects) {
      const firstKey = Object.keys(projects)[0];
      const firstProject = firstKey ? projects[firstKey] : undefined;
      const fp = firstProject as object | undefined;
      if (fp && ('retryAttempts' in fp || 'lastError' in fp)) {
        return data as Partial<RagStateShape>;
      }
    }
  }

  // Otherwise perform standard v2 → v3 migration.
  const v2Data = migrateRagToV2(data);

  const migratedProjects = {} as Record<string, RagProject>;
  for (const [id, project] of Object.entries(v2Data.projects || {})) {
    migratedProjects[id] = {
      ...project,
      retryAttempts: 0,
      lastError: null,
    };
  }

  return {
    ...v2Data,
    projects: migratedProjects,
  };
};

/**
 * Rollback v3 → v2
 * Removes retryAttempts and lastError fields.
 */
export const rollbackRagToV2 = (data: RagStateShape): Partial<RagStateShape> => {
  const migratedProjects: Record<string, Omit<RagProject, 'retryAttempts' | 'lastError'>> = {};
  for (const [id, project] of Object.entries(data.projects)) {
    const { retryAttempts: _, lastError: __, ...rest } = project;
    migratedProjects[id] = rest;
  }

  return {
    ...data,
    projects: migratedProjects as Record<string, RagProject>,
  };
};

/**
 * RAG migration registry.
 */
export const ragMigrations = {
  2: migrateRagToV2,
  3: migrateRagToV3,
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
  3: {
    migrate: migrateRagToV3,
    rollback: rollbackRagToV2,
    isRollbackable: true,
    description: 'Add retryAttempts and lastError fields for indexing retry policies',
  },
};

/**
 * Current RAG store schema version.
 */
export const RAG_STORE_VERSION = 3;
