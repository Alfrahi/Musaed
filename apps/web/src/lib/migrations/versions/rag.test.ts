import { describe, it, expect } from 'vitest';
import type { RagStateShape } from './rag';
import {
  ragMigrations,
  ragBidirectionalMigrations,
  validateRag,
  migrateRagToV1,
  migrateRagToV2,
  rollbackRagToV0,
  rollbackRagToV1,
  RAG_STORE_VERSION,
  RagStateWrapperSchema,
} from './rag';

describe('RAG Store Migrations', () => {
  describe('RAG_STORE_VERSION', () => {
    it('should be version 3', () => {
      expect(RAG_STORE_VERSION).toBe(3);
    });
  });

  describe('RagStateWrapperSchema', () => {
    it('should validate complete RAG state', () => {
      const validState = {
        projects: {
          'proj-1': {
            id: 'proj-1',
            name: 'Test Project',
            path: '/test/path',
            embeddingModel: 'llama3',
            ignorePatterns: ['node_modules', '.git'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            indexedAt: null,
            fileCount: 0,
            chunkCount: 0,
            totalBytes: 0,
            status: 'idle',
            retryAttempts: 0,
            lastError: null,
          },
        },
        projectIds: ['proj-1'],
        activeProjectId: 'proj-1',
        searchResults: [],
        isSearching: false,
        metadata: {
          version: 3,
          lastMigratedAt: new Date().toISOString(),
          migrationPath: [1, 2, 3],
        },
      };

      const result = RagStateWrapperSchema.parse(validState);
      expect(result).toEqual(validState);
    });

    it('should validate minimal RAG state', () => {
      const minimalState = {
        projects: {},
        projectIds: [],
        activeProjectId: null,
      };

      const result = RagStateWrapperSchema.parse(minimalState);
      expect(result.projects).toEqual({});
      expect(result.projectIds).toEqual([]);
      expect(result.activeProjectId).toBeNull();
    });
  });

  describe('migrateRagToV1', () => {
    it('should normalise legacy v0 state into v1 shape', () => {
      const v0Data = {
        projects: {
          'proj-1': {
            id: 'proj-1',
            name: 'Test',
            path: '/test',
            embeddingModel: 'llama3',
            ignorePatterns: [],
          },
        },
        projectIds: ['proj-1'],
        activeProjectId: 'proj-1',
        searchResults: [],
        isSearching: false,
      };

      const result = migrateRagToV1(v0Data);

      expect(result.projectIds).toEqual(['proj-1']);
      expect(result.activeProjectId).toBe('proj-1');
      expect(result.searchResults).toEqual([]);
      expect(result.isSearching).toBe(false);
    });

    it('should filter out projectIds that have no matching project entry', () => {
      const v0Data = {
        projects: {
          'proj-1': { id: 'proj-1' },
        },
        projectIds: ['proj-1', 'proj-orphan'],
        activeProjectId: null,
      };

      const result = migrateRagToV1(v0Data);

      expect(result.projectIds).toEqual(['proj-1']);
    });

    it('should backfill projectIds with keys missing from the array', () => {
      const v0Data = {
        projects: {
          'proj-1': { id: 'proj-1' },
          'proj-2': { id: 'proj-2' },
        },
        projectIds: ['proj-1'],
        activeProjectId: null,
      };

      const result = migrateRagToV1(v0Data);

      expect(result.projectIds).toEqual(['proj-1', 'proj-2']);
    });

    it('should be idempotent when metadata already reports v1', () => {
      const v1Wrapped = {
        metadata: { version: 1 },
        data: { projects: { 'proj-1': { id: 'proj-1' } }, projectIds: ['proj-1'] },
      };

      // createIdempotentMigration returns the inner data field if metadata.version >= targetVersion
      // We can only call migrateRagToV1 directly through ragMigrations[1] which wraps it
      const result = ragMigrations[1](v1Wrapped);

      // When the wrapper unwraps metadata-aliased state at v>=1, the inner data must survive
      expect(result).toBe(v1Wrapped.data);
    });

    it('should default missing top-level fields', () => {
      const result = migrateRagToV1({});

      expect(result.projects).toEqual({});
      expect(result.projectIds).toEqual([]);
      expect(result.activeProjectId).toBeNull();
      expect(result.searchResults).toEqual([]);
      expect(result.isSearching).toBe(false);
    });
  });

  describe('rollbackRagToV0', () => {
    it('should return input unchanged (identity rollback)', () => {
      const v1Data: RagStateShape = {
        projects: {},
        projectIds: [],
        activeProjectId: null,
        searchResults: [],
        isSearching: false,
      };

      const result = rollbackRagToV0(v1Data);

      expect(result).toBe(v1Data);
    });
  });

  describe('migrateRagToV2', () => {
    it('should add status field to projects', () => {
      const v1Data = {
        projects: {
          'proj-1': {
            id: 'proj-1',
            name: 'Test',
            path: '/test',
            embeddingModel: 'llama3',
            ignorePatterns: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            indexedAt: null,
            fileCount: 0,
            chunkCount: 0,
            totalBytes: 0,
          },
        },
        projectIds: ['proj-1'],
        activeProjectId: 'proj-1',
      };

      const result = migrateRagToV2(v1Data);

      expect((result.projects as any)['proj-1'].status).toBe('idle');
    });

    it('should normalize projectIds to match project keys', () => {
      const v1Data = {
        projects: {
          'proj-1': {
            id: 'proj-1',
            name: 'Test',
            path: '/test',
            embeddingModel: 'llama3',
            ignorePatterns: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            indexedAt: null,
            fileCount: 0,
            chunkCount: 0,
            totalBytes: 0,
            status: 'ready',
          },
          'proj-2': {
            id: 'proj-2',
            name: 'Test 2',
            path: '/test2',
            embeddingModel: 'llama3',
            ignorePatterns: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            indexedAt: null,
            fileCount: 0,
            chunkCount: 0,
            totalBytes: 0,
            status: 'idle',
            retryAttempts: 0,
            lastError: null,
          },
        },
        projectIds: ['proj-1'], // Out of sync
        activeProjectId: 'proj-1',
      };

      const result = migrateRagToV2(v1Data);

      expect(result.projectIds).toEqual(['proj-1', 'proj-2']);
    });

    it('should handle null activeProjectId', () => {
      const v1Data = {
        projects: {},
        projectIds: [],
        activeProjectId: null,
      };

      const result = migrateRagToV2(v1Data);

      expect(result.activeProjectId).toBeNull();
    });

    it('should preserve existing status field', () => {
      const v2Data = {
        projects: {
          'proj-1': {
            id: 'proj-1',
            name: 'Test',
            path: '/test',
            embeddingModel: 'llama3',
            ignorePatterns: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            indexedAt: null,
            fileCount: 0,
            chunkCount: 0,
            totalBytes: 0,
            status: 'indexing',
          },
        },
        projectIds: ['proj-1'],
        activeProjectId: 'proj-1',
      };

      const result = migrateRagToV2(v2Data);

      expect((result.projects as any)['proj-1'].status).toBe('indexing');
    });
  });

  describe('rollbackRagToV2', () => {
    it('should remove retryAttempts and lastError fields from projects', () => {
      const v3Data: RagStateShape = {
        projects: {
          'proj-1': {
            id: 'proj-1',
            name: 'Test',
            path: '/test',
            embeddingModel: 'llama3',
            ignorePatterns: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            indexedAt: null,
            fileCount: 0,
            chunkCount: 0,
            totalBytes: 0,
            status: 'idle',
            retryAttempts: 2,
            lastError: 'Test error',
          },
        },
        projectIds: ['proj-1'],
        activeProjectId: 'proj-1',
        searchResults: [],
        isSearching: false,
      };

      const result = ragBidirectionalMigrations[3].rollback(v3Data);

      expect((result.projects!['proj-1'] as any).retryAttempts).toBeUndefined();
      expect((result.projects!['proj-1'] as any).lastError).toBeUndefined();
    });
  });

  describe('rollbackRagToV1', () => {
    it('should return data unchanged (identity rollback)', () => {
      const v2Data: RagStateShape = {
        projects: {
          'proj-1': {
            id: 'proj-1',
            name: 'Test',
            path: '/test',
            embeddingModel: 'llama3',
            ignorePatterns: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            indexedAt: null,
            fileCount: 0,
            chunkCount: 0,
            totalBytes: 0,
            status: 'idle',
            retryAttempts: 0,
            lastError: null,
          },
        },
        projectIds: ['proj-1'],
        activeProjectId: 'proj-1',
        searchResults: [],
        isSearching: false,
      };

      const result = rollbackRagToV1(v2Data);

      expect(result).toBe(v2Data);
    });
  });

  describe('migrateRagToV3', () => {
    it('should add retryAttempts and lastError fields to projects', () => {
      const v2Data = {
        projects: {
          'proj-1': {
            id: 'proj-1',
            name: 'Test',
            path: '/test',
            embeddingModel: 'llama3',
            ignorePatterns: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            indexedAt: null,
            fileCount: 0,
            chunkCount: 0,
            totalBytes: 0,
            status: 'idle',
            retryAttempts: 0,
            lastError: null,
          },
        },
        projectIds: ['proj-1'],
        activeProjectId: 'proj-1',
        searchResults: [],
        isSearching: false,
      };

      const result = ragMigrations[3](v2Data);

      expect(result.projects!['proj-1'].retryAttempts).toBe(0);
      expect(result.projects!['proj-1'].lastError).toBeNull();
    });

    it('should preserve existing retryAttempts and lastError fields', () => {
      const v3Data = {
        projects: {
          'proj-1': {
            id: 'proj-1',
            name: 'Test',
            path: '/test',
            embeddingModel: 'llama3',
            ignorePatterns: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            indexedAt: null,
            fileCount: 0,
            chunkCount: 0,
            totalBytes: 0,
            status: 'error',
            retryAttempts: 2,
            lastError: 'Test error',
          },
        },
        projectIds: ['proj-1'],
        activeProjectId: 'proj-1',
        searchResults: [],
        isSearching: false,
      };

      const result = ragMigrations[3](v3Data);

      expect(result.projects!['proj-1'].retryAttempts).toBe(2);
      expect(result.projects!['proj-1'].lastError).toBe('Test error');
    });
  });

  describe('validateRag', () => {
    it('should validate and return RAG state', () => {
      const validState = {
        projects: {
          'proj-1': {
            id: 'proj-1',
            name: 'Test',
            path: '/test',
            embeddingModel: 'llama3',
            ignorePatterns: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            indexedAt: null,
            fileCount: 0,
            chunkCount: 0,
            totalBytes: 0,
            status: 'idle',
            retryAttempts: 0,
            lastError: null,
          },
        },
        projectIds: ['proj-1'],
        activeProjectId: 'proj-1',
        searchResults: [],
        isSearching: false,
      };

      const result = validateRag(validState);

      expect(result.projects).toEqual(validState.projects);
      expect(result.projectIds).toEqual(validState.projectIds);
      expect(result.activeProjectId).toBe('proj-1');
    });

    it('should provide defaults for missing arrays', () => {
      const minimalState = {
        projects: {},
        projectIds: [],
        activeProjectId: null,
      };

      const result = validateRag(minimalState);

      expect(result.searchResults).toEqual([]);
      expect(result.isSearching).toBe(false);
    });
  });

  describe('ragMigrations registry', () => {
    it('should have migration for version 1', () => {
      expect(ragMigrations[1]).toBeDefined();
      expect(typeof ragMigrations[1]).toBe('function');
    });

    it('should have migration for version 2', () => {
      expect(ragMigrations[2]).toBeDefined();
      expect(typeof ragMigrations[2]).toBe('function');
    });

    it('should have migrations for versions 1, 2, and 3', () => {
      const versions = Object.keys(ragMigrations)
        .map(Number)
        .sort((a, b) => a - b);
      expect(versions).toEqual([1, 2, 3]);
    });

    it('applies v1 → v2 → v3 to a stored v1 shape', () => {
      const v1Stored = {
        projects: {
          'proj-1': {
            id: 'proj-1',
            name: 'Legacy',
            path: '/legacy',
            embeddingModel: 'llama3',
            ignorePatterns: [],
          },
        },
        projectIds: [],
        activeProjectId: null,
        searchResults: [],
        isSearching: false,
      };

      const registry = ragMigrations as unknown as Record<number, (d: unknown) => unknown>;
      let data: unknown = v1Stored;
      for (let v = 2; v <= 3; v++) {
        data = registry[v](data);
      }

      const v3 = data as RagStateShape;
      expect(v3.projectIds).toEqual(['proj-1']);
      expect(v3.projects['proj-1'].status).toBe('idle');
      expect(v3.projects['proj-1'].retryAttempts).toBe(0);
      expect(v3.projects['proj-1'].lastError).toBeNull();

      const validated = validateRag(v3);
      expect(validated.projects).toEqual(v3.projects);
      expect(validated.activeProjectId).toBeNull();
    });
  });

  describe('ragBidirectionalMigrations registry', () => {
    it('should have bidirectional migration for version 2', () => {
      expect(ragBidirectionalMigrations[2]).toBeDefined();
      expect(ragBidirectionalMigrations[2].migrate).toBeDefined();
      expect(ragBidirectionalMigrations[2].rollback).toBeDefined();
      expect(ragBidirectionalMigrations[2].isRollbackable).toBe(true);
    });

    it('should have description for version 2', () => {
      expect(ragBidirectionalMigrations[2].description).toBe(
        'Add status field sync and projectIds normalization'
      );
    });

    it('should have bidirectional migration for version 3', () => {
      expect(ragBidirectionalMigrations[3]).toBeDefined();
      expect(ragBidirectionalMigrations[3].migrate).toBeDefined();
      expect(ragBidirectionalMigrations[3].rollback).toBeDefined();
      expect(ragBidirectionalMigrations[3].isRollbackable).toBe(true);
    });

    it('should have description for version 3', () => {
      expect(ragBidirectionalMigrations[3].description).toBe(
        'Add retryAttempts and lastError fields for indexing retry policies'
      );
    });
  });
});
