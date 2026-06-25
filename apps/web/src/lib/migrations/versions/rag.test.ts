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
    it('should be version 2', () => {
      expect(RAG_STORE_VERSION).toBe(2);
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
          },
        },
        projectIds: ['proj-1'],
        activeProjectId: 'proj-1',
        searchResults: [],
        isSearching: false,
        metadata: {
          version: 2,
          lastMigratedAt: new Date().toISOString(),
          migrationPath: [1, 2],
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

    it('should only have version 2 migration', () => {
      const versions = Object.keys(ragMigrations).map(Number);
      expect(versions).toEqual([2]);
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
  });
});
