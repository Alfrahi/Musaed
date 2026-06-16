/**
 * Migration Framework Index
 *
 * Re-exports all migration utilities and version-specific migrations.
 *
 * Usage:
 * ```typescript
 * import {
 *   runMigrations,
 *   rollbackMigrations,
 *   settingsMigrations,
 *   modelMigrations,
 *   ragMigrations,
 * } from '@/lib/migrations';
 * ```
 */

// Core orchestrator
export {
  runMigrations,
  rollbackMigrations,
  createIdempotentMigration,
  extractVersion,
  extractData,
  type StoreMigrationConfig,
} from './orchestrator';

// Version-specific migrations
export {
  settingsMigrations,
  settingsBidirectionalMigrations,
  validateSettings,
  migrateSettingsToV1,
  migrateSettingsToV2,
  rollbackSettingsToV0,
  rollbackSettingsToV1,
} from './versions/settings';

export {
  modelMigrations,
  validateModel,
  migrateModelToV1,
  MODEL_STORE_VERSION,
} from './versions/model';

export {
  ragMigrations,
  ragBidirectionalMigrations,
  validateRag,
  migrateRagToV2,
  rollbackRagToV1,
  RAG_STORE_VERSION,
} from './versions/rag';

// Shared contracts (re-export from @musaed/contracts)
export type {
  MigrationFn,
  MigrationRegistry,
  MigrationResult,
  RollbackFn,
  BidirectionalMigration,
  BidirectionalMigrationRegistry,
} from '@musaed/contracts/migrations';

export {
  MigrationError,
  MigrationErrorCode,
  createMigrationMetadata,
  isValidVersionSequence,
} from '@musaed/contracts/migrations';

export type {
  MigrationMetadata,
  SqlMigrationStep,
  IDbMigrationResult as DbMigrationResult,
  RunMigrationsRequest,
  RunMigrationsResponse,
  MigrationStatus,
} from '@musaed/contracts/migrations';
