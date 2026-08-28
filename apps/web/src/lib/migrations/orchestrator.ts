/**
 * Frontend Migration Framework
 *
 * Provides utilities for running migrations on Zustand store persisted state.
 * All migrations are sequential, idempotent, and validated.
 *
 * Architecture:
 * - migrations/orchestrator.ts - Central migration runner
 * - migrations/versions/       - Version-specific migration functions
 * - migrations/rollback.ts     - Rollback coordination
 */

import {
  type MigrationMetadata,
  type MigrationResult,
  MigrationError,
  MigrationErrorCode,
  type MigrationRegistry,
  type BidirectionalMigrationRegistry,
} from '@musaed/contracts';

/**
 * Orchestrates sequential migration execution for Zustand stores.
 *
 * Example usage:
 * ```typescript
 * const config: StoreMigrationConfig<SettingsState> = {
 *   currentVersion: 2,
 *   migrations: { 2: migrateToV2 },
 *   validate: SettingsSchema.parse,
 *   defaultState: DEFAULT_SETTINGS,
 * };
 *
 * const result = await runMigrations(persistedData, config);
 * ```
 */
export interface StoreMigrationConfig<T> {
  /** Current/target schema version */
  currentVersion: number;
  /** Migration functions indexed by target version */
  migrations: MigrationRegistry<T>;
  /** Optional bidirectional migrations with rollback support */
  bidirectionalMigrations?: BidirectionalMigrationRegistry<T>;
  /** Validation function (Zod schema parse) */
  validate: (data: unknown) => T;
  /** Default state if migration fails completely */
  defaultState: T;
  /** Store name for logging */
  storeName: string;
}

/**
 * Runs sequential migrations on persisted state.
 *
 * Migration flow:
 * 1. Extract version from metadata (default: 0 if none)
 * 2. Validate version sequence
 * 3. Apply each migration in order
 * 4. Validate result against schema
 * 5. Return migrated data with new metadata
 *
 * @param persistedState - Raw persisted data (may include metadata)
 * @param config - Migration configuration
 * @returns Migration result with migrated data or error
 */

/**
 * Validates data against schema and wraps result.
 */
function validateMigrationResult<T>(
  data: unknown,
  validate: (data: unknown) => T,
  version: number,
  errorCode: MigrationErrorCode.VALIDATION_ERROR
):
  | { success: true; data: T }
  | { success: false; error: MigrationError; fromVersion: number; toVersion: number } {
  try {
    const validated = validate(data);
    return { success: true, data: validated };
  } catch (error) {
    return {
      success: false,
      error: new MigrationError(
        errorCode,
        version,
        version,
        errorCode === MigrationErrorCode.VALIDATION_ERROR
          ? 'Migrated data failed validation'
          : `Data at version ${version} failed validation`,
        error
      ),
      fromVersion: version,
      toVersion: version,
    };
  }
}

export async function runMigrations<T>(
  persistedState: unknown,
  config: StoreMigrationConfig<T>
): Promise<MigrationResult<T>> {
  const { currentVersion, migrations } = config;

  // Extract version from metadata or default to 0
  let fromVersion = 0;
  let data: unknown = persistedState;

  if (
    typeof persistedState === 'object' &&
    persistedState !== null &&
    'version' in persistedState
  ) {
    const meta = persistedState as Partial<MigrationMetadata>;
    fromVersion = typeof meta.version === 'number' ? meta.version : 0;
    // Extract actual data if wrapped with metadata
    data = 'data' in persistedState ? (persistedState as { data: unknown }).data : persistedState;
  }

  // No migration needed
  if (fromVersion >= currentVersion) {
    const result = validateMigrationResult(
      data,
      config.validate,
      fromVersion,
      MigrationErrorCode.VALIDATION_ERROR
    );
    if (result.success) {
      return {
        success: true,
        data: result.data,
        fromVersion,
        toVersion: fromVersion,
      };
    }
    return result;
  }

  // Track migration path
  const migrationPath: number[] = [];
  let currentData = data;

  // Apply migrations sequentially
  for (let targetVersion = fromVersion + 1; targetVersion <= currentVersion; targetVersion++) {
    const migration = migrations[targetVersion];

    if (!migration) {
      return {
        success: false,
        fromVersion,
        toVersion: targetVersion,
        error: new MigrationError(
          MigrationErrorCode.MISSING_MIGRATION,
          targetVersion - 1,
          targetVersion,
          `No migration found for version ${targetVersion}`
        ),
      };
    }

    try {
      currentData = migration(currentData);
      migrationPath.push(targetVersion);
    } catch (error) {
      return {
        success: false,
        fromVersion,
        toVersion: targetVersion,
        error: new MigrationError(
          MigrationErrorCode.MIGRATION_FAILED,
          targetVersion - 1,
          targetVersion,
          `Migration to v${targetVersion} failed`,
          error
        ),
      };
    }
  }

  // Validate final result
  const result = validateMigrationResult(
    currentData,
    config.validate,
    currentVersion,
    MigrationErrorCode.VALIDATION_ERROR
  );
  if (result.success) {
    return {
      success: true,
      data: result.data,
      fromVersion,
      toVersion: currentVersion,
    };
  }
  return result;
}

/**
 * Rolls back migrations in reverse order.
 * Only works if all migrations in the path are rollbackable.
 *
 * @param data - Current migrated data
 * @param fromVersion - Current version
 * @param toVersion - Target (lower) version
 * @param bidirectionalMigrations - Migrations with rollback support
 * @returns Rollback result
 */
export async function rollbackMigrations<T>(
  data: T,
  fromVersion: number,
  toVersion: number,
  bidirectionalMigrations: BidirectionalMigrationRegistry<T>
): Promise<MigrationResult<T>> {
  // Validate rollback sequence
  if (toVersion >= fromVersion) {
    return {
      success: false,
      fromVersion,
      toVersion,
      error: new MigrationError(
        MigrationErrorCode.INVALID_VERSION_SEQUENCE,
        fromVersion,
        toVersion,
        `Cannot roll back from v${fromVersion} to v${toVersion} (must be lower)`
      ),
    };
  }

  // Check all migrations are rollbackable
  for (let v = fromVersion; v > toVersion; v--) {
    const migration = bidirectionalMigrations[v];
    if (!migration || !migration.isRollbackable || !migration.rollback) {
      return {
        success: false,
        fromVersion,
        toVersion,
        error: new MigrationError(
          MigrationErrorCode.ROLLBACK_FAILED,
          v,
          v - 1,
          `Migration v${v} is not rollbackable`
        ),
      };
    }
  }

  let currentData: unknown = data;

  // Apply rollbacks in reverse order
  for (let v = fromVersion; v > toVersion; v--) {
    const migration = bidirectionalMigrations[v];
    if (!migration.rollback) {
      return {
        success: false,
        fromVersion,
        toVersion,
        error: new MigrationError(
          MigrationErrorCode.ROLLBACK_FAILED,
          v,
          v - 1,
          `Rollback function missing for v${v}`
        ),
      };
    }
    try {
      currentData = migration.rollback(currentData as T);
    } catch (error) {
      return {
        success: false,
        fromVersion,
        toVersion,
        error: new MigrationError(
          MigrationErrorCode.ROLLBACK_FAILED,
          v,
          v - 1,
          `Rollback from v${v} failed`,
          error
        ),
      };
    }
  }

  return {
    success: true,
    data: currentData as T,
    fromVersion,
    toVersion,
  };
}

/**
 * Creates a safe migration wrapper that ensures idempotency.
 * If migration has already been applied, returns data unchanged.
 */
export function createIdempotentMigration<T>(
  migration: (data: T) => T,
  targetVersion: number
): (data: unknown) => T {
  return (data: unknown): T => {
    // Check if migration already applied (data has target version)
    if (typeof data === 'object' && data !== null && 'metadata' in data) {
      const mData = data as { metadata?: { version?: number }; data?: T };
      if (
        mData.metadata &&
        typeof mData.metadata.version === 'number' &&
        mData.metadata.version >= targetVersion
      ) {
        // Already migrated - return data as-is (idempotent)
        return mData.data as T;
      }
    }

    return migration(data as T);
  };
}
