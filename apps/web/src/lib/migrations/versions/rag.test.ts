import { describe, it, expect } from 'vitest';
import type { RagStateShape } from './rag';
import {
  ragMigrations,
  ragBidirectionalMigrations,
  validateRag,
  migrateRagToV2,
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
    it('should have migration for version 2', () => {
      expect(ragMigrations[2]).toBeDefined();
      expect(typeof ragMigrations[2]).toBe('function');
    });

    it('should have migrations for versions 2 and 3', () => {
      const versions = Object.keys(ragMigrations).map(Number);
      expect(versions).toEqual([2, 3]);
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
