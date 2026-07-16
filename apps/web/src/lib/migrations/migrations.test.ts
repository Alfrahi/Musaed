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
import { migrateRagToV2, type RagStateShape } from './versions/rag';
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

/**
 * Stress tests for migration framework with large datasets.
 * Ensures migrations perform correctly under load.
 */
describe('Migration Stress Tests', () => {
  const LARGE_DATASET_SIZE = 1000;
  const PERFORMANCE_BUDGET_MS = 5000; // 5 seconds

  /**
   * Creates a mock RAG project with chunks for stress testing.
   */
  function createMockRagProject(index: number) {
    return {
      id: `project-${index}`,
      name: `Project ${index}`,
      path: `/test/path/project-${index}`,
      embeddingModel: 'nomic-embed-text',
      ignorePatterns: ['node_modules', '.git'],
      createdAt: new Date(Date.now() - index * 1000 * 60).toISOString(),
      updatedAt: new Date(Date.now() - index * 1000 * 30).toISOString(),
      indexedAt: new Date(Date.now() - index * 1000 * 15).toISOString(),
      fileCount: Math.floor(Math.random() * 100) + 10,
      chunkCount: Math.floor(Math.random() * 1000) + 100,
      totalBytes: Math.floor(Math.random() * 1000000) + 10000,
      status: 'idle' as const,
    };
  }

  describe('Large dataset migrations', () => {
    it('should migrate 1000+ settings records within performance budget', async () => {
      const startTime = performance.now();

      // Create mock large dataset
      const mockData = Array.from({ length: LARGE_DATASET_SIZE }, (_, i) => ({
        theme: i % 2 === 0 ? 'dark' : 'light',
        language: i % 3 === 0 ? 'ar' : 'en',
      }));

      // Simulate migrating each record
      const results = mockData.map((data) => settingsMigrations[2](settingsMigrations[1](data)));

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Verify all migrations succeeded
      expect(results).toHaveLength(LARGE_DATASET_SIZE);
      expect(results.every((r) => r.density !== undefined)).toBe(true);
      expect(results.every((r) => r.theme !== undefined)).toBe(true);

      // Verify performance
      expect(duration).toBeLessThan(PERFORMANCE_BUDGET_MS);
      console.log(
        `Settings migration: ${LARGE_DATASET_SIZE} records in ${duration.toFixed(2)}ms (${(duration / LARGE_DATASET_SIZE).toFixed(4)}ms/record)`
      );
    });

    it('should migrate 1000+ RAG projects with data integrity', async () => {
      const startTime = performance.now();

      // Create mock large dataset - individual project objects
      const mockProjects = Array.from({ length: LARGE_DATASET_SIZE }, (_, i) =>
        createMockRagProject(i)
      );

      // Simulate migrating each project by wrapping in state shape
      const results = mockProjects.map((project) => {
        // Wrap single project in state shape for migration
        const stateWrapper = {
          projects: { [project.id]: project },
          projectIds: [project.id],
          activeProjectId: project.id,
        };
        const migrated = migrateRagToV2(stateWrapper) as RagStateShape;
        // Extract the migrated project from the result
        return migrated.projects[project.id];
      });

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Verify all migrations succeeded
      expect(results).toHaveLength(LARGE_DATASET_SIZE);

      // Spot-check random records for data integrity
      const randomIndices = [0, 100, 500, 999];
      for (const idx of randomIndices) {
        if (idx < results.length) {
          expect(results[idx].status).toBeDefined();
          expect(results[idx].status).toBe('idle'); // migrateRagToV2 defaults to 'idle'
          expect(results[idx].id).toBe(mockProjects[idx].id);
        }
      }

      // Verify all projects have status field
      expect(results.every((r) => r.status !== undefined)).toBe(true);

      // Verify performance
      expect(duration).toBeLessThan(PERFORMANCE_BUDGET_MS);
      console.log(
        `RAG migration: ${LARGE_DATASET_SIZE} projects in ${duration.toFixed(2)}ms (${(duration / LARGE_DATASET_SIZE).toFixed(4)}ms/project)`
      );
    });

    it('should handle idempotent migrations on large dataset', async () => {
      // Create already-migrated data
      const alreadyMigratedData = Array.from({ length: LARGE_DATASET_SIZE }, (_, i) => ({
        ...DEFAULT_SETTINGS,
        density: 1.0 + i * 0.01,
      }));

      const startTime = performance.now();

      // Run migration again (should be idempotent)
      const results = alreadyMigratedData.map((data) => migrateSettingsToV2(data));

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Verify idempotency - all data unchanged
      results.forEach((result, idx) => {
        expect(result.density).toBe(alreadyMigratedData[idx].density);
      });

      // Verify performance (idempotent should be faster)
      expect(duration).toBeLessThan(PERFORMANCE_BUDGET_MS);
      console.log(
        `Idempotent migration: ${LARGE_DATASET_SIZE} records in ${duration.toFixed(2)}ms`
      );
    });

    it('should verify rollback correctness on large dataset', async () => {
      // Create v2 data
      const v2Data = Array.from({ length: LARGE_DATASET_SIZE }, (_, i) => ({
        ...DEFAULT_SETTINGS,
        density: 1.0 + i * 0.01,
      }));

      const startTime = performance.now();

      // Rollback all to v1
      const { rollback } = settingsBidirectionalMigrations[2];
      const rollbackResults = v2Data.map((data) => rollback(data));

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Verify all rollbacks succeeded
      expect(rollbackResults).toHaveLength(LARGE_DATASET_SIZE);

      // Spot-check random records
      const randomIndices = [0, 250, 500, 750, 999];
      for (const idx of randomIndices) {
        if (idx < rollbackResults.length) {
          expect((rollbackResults[idx] as any).density).toBeUndefined();
          expect(rollbackResults[idx].theme).toBe(v2Data[idx].theme);
        }
      }

      // Verify all density fields removed
      expect(rollbackResults.every((r) => (r as any).density === undefined)).toBe(true);

      // Verify performance
      expect(duration).toBeLessThan(PERFORMANCE_BUDGET_MS);
      console.log(
        `Rollback: ${LARGE_DATASET_SIZE} records in ${duration.toFixed(2)}ms (${(duration / LARGE_DATASET_SIZE).toFixed(4)}ms/record)`
      );
    });
  });

  describe('Edge cases and failure modes', () => {
    it('should handle empty dataset gracefully', async () => {
      const emptyConfig = {
        currentVersion: 2,
        migrations: settingsMigrations,
        validate: validateSettings,
        defaultState: DEFAULT_SETTINGS,
        storeName: 'test-settings',
      };

      const result = await runMigrations({}, emptyConfig);

      expect(result.success).toBe(true);
      expect(result.toVersion).toBe(2);
    });

    it('should handle partial failures with proper error reporting', async () => {
      const failingMigration = {
        500: () => {
          throw new Error('Simulated failure at record 500');
        },
      };

      const config: any = {
        currentVersion: 501,
        migrations: failingMigration,
        validate: (data: unknown) => data as any,
        defaultState: {},
        storeName: 'test-fail',
      };

      const result = await runMigrations({}, config);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.toVersion).toBe(1);
    });
  });
});
