/**
 * Migration Framework Tests
 *
 * Tests for the frontend migration orchestrator and version-specific migrations.
 * Covers:
 * - Sequential migration execution
 * - Rollback functionality
 * - Idempotent execution
 * - Version tracking
 * - Error handling
 */

import { describe, it, expect } from 'vitest';
import {
  runMigrations,
  rollbackMigrations,
  createIdempotentMigration,
  extractVersion,
  extractData,
} from './orchestrator';
import { MigrationErrorCode } from '@musaed/contracts/migrations';
import {
  settingsMigrations,
  settingsBidirectionalMigrations,
  validateSettings,
  migrateSettingsToV2,
} from './versions/settings';
import { DEFAULT_SETTINGS } from '@musaed/contracts';

describe('Migration Orchestrator', () => {
  describe('runMigrations', () => {
    it('should return success when already at target version', async () => {
      const config = {
        currentVersion: 1,
        migrations: settingsMigrations,
        validate: validateSettings,
        defaultState: DEFAULT_SETTINGS,
        storeName: 'test-settings',
      };

      // Simulate data already at v1
      const persistedState = {
        version: 1,
        data: DEFAULT_SETTINGS,
      };

      const result = await runMigrations(persistedState, config);

      expect(result.success).toBe(true);
      expect(result.fromVersion).toBe(1);
      expect(result.toVersion).toBe(1);
    });

    it('should migrate from v0 to v1 successfully', async () => {
      const config = {
        currentVersion: 1,
        migrations: settingsMigrations,
        validate: validateSettings,
        defaultState: DEFAULT_SETTINGS,
        storeName: 'test-settings',
      };

      // Simulate data at v0 (no version field)
      const persistedState = { theme: 'dark', language: 'en' };

      const result = await runMigrations(persistedState, config);

      expect(result.success).toBe(true);
      expect(result.fromVersion).toBe(0);
      expect(result.toVersion).toBe(1);
      expect(result.data).toBeDefined();
    });

    it('should apply migrations sequentially', async () => {
      const config = {
        currentVersion: 2,
        migrations: {
          1: (data: unknown) => ({ ...(data as object), v1Applied: true }) as any,
          2: migrateSettingsToV2,
        },
        validate: (data: unknown) => data as any,
        defaultState: DEFAULT_SETTINGS,
        storeName: 'test-settings',
      } as any;

      const persistedState = { theme: 'dark' };

      const result = await runMigrations(persistedState, config);

      expect(result.success).toBe(true);
      expect(result.fromVersion).toBe(0);
      expect(result.toVersion).toBe(2);
      expect((result.data as any)?.v1Applied).toBe(true);
    });

    it('should fail when migration function is missing', async () => {
      const config = {
        currentVersion: 3,
        migrations: {
          1: (_data: unknown) => _data as any,
          // Missing v2 migration
          3: (_data: unknown) => _data as any,
        },
        validate: (_data: unknown) => _data as any,
        defaultState: DEFAULT_SETTINGS,
        storeName: 'test-settings',
      };

      const persistedState = {};

      const result = await runMigrations(persistedState, config);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe(MigrationErrorCode.MISSING_MIGRATION);
      expect(result.toVersion).toBe(2); // Failed at v2
    });

    it('should fail when migration throws an error', async () => {
      const config = {
        currentVersion: 2,
        migrations: {
          1: (_data: unknown) => {
            throw new Error('Migration v1 failed');
          },
          2: migrateSettingsToV2,
        },
        validate: (_data: unknown) => _data as any,
        defaultState: DEFAULT_SETTINGS,
        storeName: 'test-settings',
      };

      const persistedState = {};

      const result = await runMigrations(persistedState, config);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(MigrationErrorCode.MIGRATION_FAILED);
      expect(result.fromVersion).toBe(0);
      expect(result.toVersion).toBe(1);
    });

    it('should fail when migrated data fails validation', async () => {
      const config = {
        currentVersion: 1,
        migrations: {
          1: () => ({ invalid: 'data' }) as any, // Invalid settings
        },
        validate: validateSettings,
        defaultState: DEFAULT_SETTINGS,
        storeName: 'test-settings',
      } as any;

      const persistedState = {};

      const result = await runMigrations(persistedState, config);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(MigrationErrorCode.VALIDATION_ERROR);
    });
  });

  describe('rollbackMigrations', () => {
    it('should rollback from v2 to v1 successfully', async () => {
      const testData = { ...DEFAULT_SETTINGS, density: 1.0 };

      const result = await rollbackMigrations(testData, 2, 1, settingsBidirectionalMigrations);

      expect(result.success).toBe(true);
      expect(result.fromVersion).toBe(2);
      expect(result.toVersion).toBe(1);
    });

    it('should fail when rolling back to same or higher version', async () => {
      const testData = { ...DEFAULT_SETTINGS };

      const result = await rollbackMigrations(testData, 2, 2, settingsBidirectionalMigrations);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(MigrationErrorCode.INVALID_VERSION_SEQUENCE);
    });

    it('should fail when migration is not rollbackable', async () => {
      const nonRollbackableMigrations = {
        2: {
          migrate: migrateSettingsToV2,
          rollback: undefined,
          isRollbackable: false,
          description: 'Test',
        },
      };

      const testData = { ...DEFAULT_SETTINGS };

      const result = await rollbackMigrations(testData, 2, 1, nonRollbackableMigrations);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(MigrationErrorCode.ROLLBACK_FAILED);
    });

    it('should fail when rollback function throws', async () => {
      const failingRollbackMigrations = {
        2: {
          migrate: migrateSettingsToV2,
          rollback: () => {
            throw new Error('Rollback failed');
          },
          isRollbackable: true,
          description: 'Test',
        },
      };

      const testData = { ...DEFAULT_SETTINGS };

      const result = await rollbackMigrations(testData, 2, 1, failingRollbackMigrations);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(MigrationErrorCode.ROLLBACK_FAILED);
    });
  });

  describe('createIdempotentMigration', () => {
    it('should apply migration when not yet applied', () => {
      const migration = createIdempotentMigration((data: any) => ({ ...data, migrated: true }), 1);

      const data = { value: 'test' };
      const result = migration(data);

      expect(result.migrated).toBe(true);
    });

    it('should return data unchanged when already migrated', () => {
      const migration = createIdempotentMigration((data: any) => ({ ...data, migrated: true }), 1);

      const alreadyMigrated = {
        data: { migrated: true },
        metadata: { version: 1 },
      };

      const result = migration(alreadyMigrated);

      expect(result.migrated).toBe(true);
      expect(result).toBe(alreadyMigrated.data); // Same reference
    });
  });

  describe('extractVersion', () => {
    it('should extract version from wrapped metadata', () => {
      const state = {
        data: {},
        metadata: { version: 2 },
      };

      expect(extractVersion(state)).toBe(2);
    });

    it('should extract version from flat format', () => {
      const state = { version: 1, theme: 'dark' };

      expect(extractVersion(state)).toBe(1);
    });

    it('should return 0 when no version exists', () => {
      const state = { theme: 'dark' };

      expect(extractVersion(state)).toBe(0);
    });

    it('should return 0 for non-object input', () => {
      expect(extractVersion(null)).toBe(0);
      expect(extractVersion(undefined)).toBe(0);
      expect(extractVersion(123)).toBe(0);
    });
  });

  describe('extractData', () => {
    it('should extract data from wrapped format', () => {
      const state = {
        data: { theme: 'dark' },
        metadata: { version: 1 },
      };

      expect(extractData(state)).toEqual({ theme: 'dark' });
    });

    it('should extract data from unwrapped format', () => {
      const state = { version: 1, theme: 'dark' };

      expect(extractData(state)).toEqual({ theme: 'dark' });
    });

    it('should return undefined for non-object input', () => {
      expect(extractData(null)).toBeUndefined();
    });
  });
});

describe('Settings Migrations', () => {
  it('v1 migration should merge with defaults', () => {
    const partialData = { theme: 'dark' };
    const result = settingsMigrations[1](partialData);

    expect(result.theme).toBe('dark');
    expect(result.language).toBe('en'); // From defaults
    expect(result.density).toBe(1.0); // From defaults
  });

  it('v2 migration should add density field', () => {
    const v1Data = { ...DEFAULT_SETTINGS };
    delete (v1Data as any).density;

    const result = migrateSettingsToV2(v1Data);

    expect(result.density).toBe(1.0);
  });

  it('v2 migration should be idempotent', () => {
    const alreadyMigrated = { ...DEFAULT_SETTINGS, density: 1.5 };

    const result1 = migrateSettingsToV2(alreadyMigrated);
    const result2 = migrateSettingsToV2(result1);

    expect(result1.density).toBe(1.5);
    expect(result2.density).toBe(1.5);
  });

  it('rollback should remove density field', () => {
    const v2Data = { ...DEFAULT_SETTINGS, density: 1.5 };
    const { rollback } = settingsBidirectionalMigrations[2];

    const result = rollback(v2Data);

    expect((result as any).density).toBeUndefined();
  });
});
