import { describe, it, expect } from 'vitest';
import type { IndexProgress, RagProject } from '@musaed/contracts';
import { deriveProjectStatus } from './rag-status';

const baseProject: RagProject = {
  id: 'proj-1',
  name: 'demo',
  path: '/demo',
  embeddingModel: 'nomic-embed-text',
  ignorePatterns: [],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  indexedAt: null,
  fileCount: 0,
  chunkCount: 0,
  totalBytes: 0,
  status: 'idle',
  retryAttempts: 0,
  lastError: null,
};

const makeProgress = (
  phase: IndexProgress['phase'],
  overrides: Partial<IndexProgress> = {}
): IndexProgress => ({
  projectId: 'proj-1',
  phase,
  current: 0,
  total: 0,
  message: '',
  ...overrides,
});

describe('deriveProjectStatus', () => {
  describe('status derivation', () => {
    it('returns "ready" when phase is "completed"', () => {
      const result = deriveProjectStatus(makeProgress('completed'), baseProject);
      expect(result.status).toBe('ready');
    });

    it('returns "error" when phase is "failed"', () => {
      const result = deriveProjectStatus(makeProgress('failed'), baseProject);
      expect(result.status).toBe('error');
    });

    it('returns "indexing" for any active phase', () => {
      const activePhases: IndexProgress['phase'][] = [
        'discoveringFiles',
        'diffingFiles',
        'deletingStale',
        'readingFiles',
        'chunkingFiles',
        'embeddingChunks',
        'storingChunks',
      ];
      for (const phase of activePhases) {
        expect(deriveProjectStatus(makeProgress(phase), baseProject).status).toBe('indexing');
      }
    });

    it('preserves the existing status when progress is null', () => {
      const existing: RagProject = { ...baseProject, status: 'ready' };
      const result = deriveProjectStatus(null, existing);
      expect(result.status).toBe('ready');
    });
  });

  describe('retryAttempts derivation', () => {
    it('resets to 0 on a fresh discoveringFiles phase (current === 0)', () => {
      const existing: RagProject = { ...baseProject, retryAttempts: 3 };
      const result = deriveProjectStatus(
        makeProgress('discoveringFiles', { current: 0, total: 10 }),
        existing
      );
      expect(result.retryAttempts).toBe(0);
    });

    it('treats total === 3 with current > 0 as a retry sentinel — uses current as the count', () => {
      const result = deriveProjectStatus(
        makeProgress('discoveringFiles', { current: 2, total: 3 }),
        baseProject
      );
      expect(result.retryAttempts).toBe(2);
    });

    it('does not interpret total === 3 with current === 0 as a retry', () => {
      const result = deriveProjectStatus(
        makeProgress('discoveringFiles', { current: 0, total: 3 }),
        baseProject
      );
      expect(result.retryAttempts).toBe(0);
    });

    it('preserves the existing retryAttempts for non-discoveringFiles phases', () => {
      const existing: RagProject = { ...baseProject, retryAttempts: 5 };
      const result = deriveProjectStatus(makeProgress('embeddingChunks'), existing);
      expect(result.retryAttempts).toBe(5);
    });

    it('falls back to 0 when existing.retryAttempts is undefined', () => {
      const existing: RagProject = {
        ...baseProject,
        retryAttempts: undefined as unknown as number,
      };
      const result = deriveProjectStatus(makeProgress('embeddingChunks'), existing);
      expect(result.retryAttempts).toBe(0);
    });
  });

  describe('lastError derivation', () => {
    it('captures the progress message when phase is "failed"', () => {
      const result = deriveProjectStatus(
        makeProgress('failed', { message: 'OOM killer' }),
        baseProject
      );
      expect(result.lastError).toBe('OOM killer');
    });

    it('preserves the existing lastError for non-failed phases', () => {
      const existing: RagProject = { ...baseProject, lastError: 'prior fail' };
      const result = deriveProjectStatus(makeProgress('chunkingFiles'), existing);
      expect(result.lastError).toBe('prior fail');
    });

    it('does not capture a message when phase is not "failed"', () => {
      const result = deriveProjectStatus(makeProgress('completed', { message: 'all good' }), {
        ...baseProject,
        lastError: 'old error',
      });
      expect(result.lastError).toBe('old error');
    });

    it('falls back to null when existing.lastError is undefined', () => {
      const existing: RagProject = { ...baseProject, lastError: undefined };
      const result = deriveProjectStatus(makeProgress('completed'), existing);
      expect(result.lastError).toBeNull();
    });

    it('returns null when progress is null and no prior error exists', () => {
      const result = deriveProjectStatus(null, baseProject);
      expect(result.lastError).toBeNull();
    });
  });

  describe('combined patch', () => {
    it('returns a coherent patch for a retry-failed sequence', () => {
      const existing: RagProject = {
        ...baseProject,
        status: 'error',
        retryAttempts: 1,
        lastError: 'boom',
      };
      // A retry kickoff: phase is discoveringFiles with the sentinel shape
      const result = deriveProjectStatus(
        makeProgress('discoveringFiles', { current: 2, total: 3 }),
        existing
      );
      expect(result).toEqual({ status: 'indexing', retryAttempts: 2, lastError: 'boom' });
    });
  });
});
