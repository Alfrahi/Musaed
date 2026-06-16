/**
 * Schema Migration Framework Contracts
 *
 * This module defines the shared contracts for schema migrations across
 * Zustand stores (frontend) and SQLite databases (backend).
 *
 * @module migrations
 */

import { z } from 'zod';

/**
 * Migration metadata - embedded in persisted state for version tracking.
 * Used by both frontend stores and backend databases.
 */
export const MigrationMetadataSchema = z.object({
  /** Current schema version */
  version: z.number().int().min(0),
  /** ISO 8601 timestamp of last migration */
  lastMigratedAt: z.string().datetime().optional(),
  /** Migration path taken (for debugging/audit) */
  migrationPath: z.array(z.number().int()).optional(),
});

export type MigrationMetadata = z.infer<typeof MigrationMetadataSchema>;

/**
 * Base interface for all migration functions.
 * Each migration transforms data from version N-1 to version N.
 */
export interface MigrationFn<T = unknown> {
  /**
   * Migrates data from previous schema version to current.
   * @param data - Data in previous schema format
   * @returns Data in new schema format
   * @throws MigrationError if migration fails
   */
  (data: unknown): T;
}

/**
 * Registry of migrations indexed by target version.
 * Example: { 2: migrateToV2, 3: migrateToV3 }
 */
export type MigrationRegistry<T = unknown> = Record<number, MigrationFn<T>>;

/**
 * Migration result with success/failure status.
 */
export interface MigrationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: MigrationError;
  fromVersion: number;
  toVersion: number;
}

/**
 * Migration error types for structured error handling.
 */
export enum MigrationErrorCode {
  /** Data failed validation against target schema */
  VALIDATION_ERROR = 'MIGRATION_VALIDATION_ERROR',
  /** Migration function threw an exception */
  MIGRATION_FAILED = 'MIGRATION_FAILED',
  /** Version sequence invalid (e.g., v5 → v3) */
  INVALID_VERSION_SEQUENCE = 'INVALID_VERSION_SEQUENCE',
  /** Migration not found for required version */
  MISSING_MIGRATION = 'MISSING_MIGRATION',
  /** Rollback failed */
  ROLLBACK_FAILED = 'ROLLBACK_FAILED',
  /** Data corrupted or unreadable */
  DATA_CORRUPTED = 'DATA_CORRUPTED',
}

/**
 * Structured migration error.
 */
export class MigrationError extends Error {
  public readonly code: MigrationErrorCode;
  public readonly fromVersion: number;
  public readonly toVersion: number;
  public readonly cause?: unknown;

  constructor(
    code: MigrationErrorCode,
    fromVersion: number,
    toVersion: number,
    message: string,
    cause?: unknown
  ) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    this.fromVersion = fromVersion;
    this.toVersion = toVersion;
    this.cause = cause;
  }

  /** Converts error to serializable format for logging */
  toJSON(): object {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      fromVersion: this.fromVersion,
      toVersion: this.toVersion,
      cause: this.cause instanceof Error ? this.cause.message : String(this.cause),
    };
  }
}

/**
 * Rollback function type - reverses a migration.
 * Not all migrations are reversible.
 */
export interface RollbackFn<T = unknown> {
  /**
   * Reverses a migration from version N to N-1.
   * @param data - Data in current schema format
   * @returns Data in previous schema format
   * @throws MigrationError if rollback is not supported or fails
   */
  (data: T): unknown;
}

/**
 * Bidirectional migration with optional rollback support.
 */
export interface BidirectionalMigration<T = unknown> {
  /** Forward migration (v{n-1} → v{n}) */
  migrate: MigrationFn<T>;
  /** Optional rollback (v{n} → v{n-1}) */
  rollback?: RollbackFn<T>;
  /** Whether this migration can be rolled back */
  isRollbackable: boolean;
  /** Human-readable description of what this migration changes */
  description: string;
}

/**
 * Registry of bidirectional migrations.
 */
export type BidirectionalMigrationRegistry<T = unknown> = Record<number, BidirectionalMigration<T>>;

/**
 * Store-specific migration configuration.
 * Each Zustand store should define its own migrations following this pattern.
 */
export interface StoreMigrationConfig<T> {
  /** Current schema version */
  currentVersion: number;
  /** Migration registry */
  migrations: MigrationRegistry<T>;
  /** Optional rollback registry */
  rollbacks?: RollbackFn<T>[];
  /** Validation schema for post-migration verification */
  validate: (data: unknown) => T;
  /** Default state if migration fails */
  defaultState: T;
}

/**
 * Database migrationstep for SQLite.
 * Contains SQL to apply and optionally rollback.
 */
export interface SqlMigrationStep {
  /** Target version after this step */
  version: number;
  /** SQL to apply migration */
  up: string[];
  /** Optional SQL to rollback */
  down?: string[];
  /** Whether this migration can be rolled back */
  isRollbackable: boolean;
  /** Description for logging */
  description: string;
}

/**
 * Result of running database migrations.
 */
export interface IDbMigrationResult {
  success: boolean;
  fromVersion: number;
  toVersion: number;
  appliedMigrations: number[];
  error?: string;
}

/**
 * IPC contract for triggering backend migrations.
 */
export const RunMigrationsRequestSchema = z.object({
  /** Which database to migrate */
  target: z.enum(['conversations', 'rag']),
  /** Target version (use current to apply all) */
  targetVersion: z.number().int().optional(),
  /** Whether to allow rollback on failure */
  allowRollback: z.boolean().default(true),
});

export type RunMigrationsRequest = z.infer<typeof RunMigrationsRequestSchema>;

/**
 * IPC response for migration operations.
 */
export const RunMigrationsResponseSchema = z.object({
  success: z.boolean(),
  fromVersion: z.number().int(),
  toVersion: z.number().int(),
  appliedMigrations: z.array(z.number().int()),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export type RunMigrationsResponse = z.infer<typeof RunMigrationsResponseSchema>;

/**
 * Version info returned by migration status queries.
 */
export const MigrationStatusSchema = z.object({
  target: z.enum(['conversations', 'rag']),
  currentVersion: z.number().int(),
  latestVersion: z.number().int(),
  needsMigration: z.boolean(),
  lastMigratedAt: z.string().datetime().optional(),
});

export type MigrationStatus = z.infer<typeof MigrationStatusSchema>;

/**
 * Helper to create a migration with optional rollback.
 */
export function createMigration<T>(params: {
  version: number;
  migrate: MigrationFn<T>;
  rollback?: RollbackFn<T>;
  description: string;
}): BidirectionalMigration<T> {
  return {
    migrate: params.migrate,
    rollback: params.rollback,
    isRollbackable: !!params.rollback,
    description: params.description,
  };
}

/**
 * Validates migration version sequence.
 */
export function isValidVersionSequence(from: number, to: number): boolean {
  // Can only migrate forward sequentially
  if (to < from) {
    return false;
  }
  // Skip versions not allowed (must apply all intermediate migrations)
  if (to - from > 1 && to !== from + 1) {
    return false;
  }
  return true;
}

/**
 * Generates migration metadata for storage.
 */
export function createMigrationMetadata(version: number, path?: number[]): MigrationMetadata {
  return {
    version,
    lastMigratedAt: new Date().toISOString(),
    migrationPath: path,
  };
}
