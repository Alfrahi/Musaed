import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { ragApi } from '@/lib/ipc';
import * as ragStoreHooks from '@/store/rag-store';
import { useRagProjects } from './useRagProjects';
import type { RagProject } from '@musaed/contracts';

vi.mock('@/lib/ipc', () => ({
  checkIsTauri: () => false,
  ragApi: {
    listProjects: vi.fn(),
    addProject: vi.fn(),
    removeProject: vi.fn(),
    updateProject: vi.fn(),
  },
}));

vi.mock('@/store/rag-store', () => ({
  useRagProjects: vi.fn(),
  useRagProjectIds: vi.fn(),
  useSetRagProjects: vi.fn(),
  useAddRagProject: vi.fn(),
  useRemoveRagProject: vi.fn(),
  useUpdateRagProject: vi.fn(),
}));

describe('useRagProjects', () => {
  const now = new Date().toISOString();
  const mockProject: RagProject = {
    id: 'proj1',
    name: 'Test Project',
    path: '/test/path',
    embeddingModel: 'nomic-embed-text',
    ignorePatterns: ['node_modules', '**/*.log'],
    createdAt: now,
    updatedAt: now,
    indexedAt: null,
    fileCount: 0,
    chunkCount: 0,
    totalBytes: 0,
    status: 'idle',
    retryAttempts: 0,
    lastError: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('loads projects on mount', async () => {
    (ragStoreHooks.useRagProjects as any).mockReturnValue({});
    (ragStoreHooks.useRagProjectIds as any).mockReturnValue([]);
    (ragStoreHooks.useSetRagProjects as any).mockReturnValue(vi.fn());
    (ragApi.listProjects as any).mockResolvedValue([mockProject]);

    const { result } = renderHook(() => useRagProjects());

    await waitFor(() => {
      expect(ragApi.listProjects).toHaveBeenCalled();
    });
    expect(result.current.loadProjects).toBeDefined();
  });

  it('addNewProject calls API and updates store', async () => {
    (ragStoreHooks.useRagProjects as any).mockReturnValue({});
    (ragStoreHooks.useRagProjectIds as any).mockReturnValue([]);
    const mockSetProjects = vi.fn();
    (ragStoreHooks.useSetRagProjects as any).mockReturnValue(mockSetProjects);
    const mockAddRagProject = vi.fn();
    (ragStoreHooks.useAddRagProject as any).mockReturnValue(mockAddRagProject);
    (ragApi.addProject as any).mockResolvedValue(mockProject);

    const { result } = renderHook(() => useRagProjects());

    let addResult: RagProject | null = null;
    await act(async () => {
      addResult = await result.current.addNewProject({
        name: 'New Project',
        path: '/new/path',
        embeddingModel: 'nomic-embed-text',
        ignorePatterns: [],
      });
    });

    expect(ragApi.addProject).toHaveBeenCalledWith({
      name: 'New Project',
      path: '/new/path',
      embeddingModel: 'nomic-embed-text',
      ignorePatterns: [],
    });
    expect(mockAddRagProject).toHaveBeenCalledWith(mockProject);
    expect(addResult).toEqual(mockProject);
  });

  it('removeProjectById calls API and removes from store', async () => {
    (ragStoreHooks.useRagProjects as any).mockReturnValue({ [mockProject.id]: mockProject });
    (ragStoreHooks.useRagProjectIds as any).mockReturnValue([mockProject.id]);
    (ragStoreHooks.useSetRagProjects as any).mockReturnValue(vi.fn());
    const mockRemoveRagProject = vi.fn();
    (ragStoreHooks.useRemoveRagProject as any).mockReturnValue(mockRemoveRagProject);
    (ragApi.removeProject as any).mockResolvedValue(true);

    const { result } = renderHook(() => useRagProjects());

    let removeResult: boolean | null = null;
    await act(async () => {
      removeResult = await result.current.removeProjectById(mockProject.id);
    });

    expect(ragApi.removeProject).toHaveBeenCalledWith(mockProject.id);
    expect(mockRemoveRagProject).toHaveBeenCalledWith(mockProject.id);
    expect(removeResult).toBe(true);
  });

  it('updateProjectById calls API and updates store', async () => {
    (ragStoreHooks.useRagProjects as any).mockReturnValue({ [mockProject.id]: mockProject });
    (ragStoreHooks.useRagProjectIds as any).mockReturnValue([mockProject.id]);
    (ragStoreHooks.useSetRagProjects as any).mockReturnValue(vi.fn());
    const mockUpdateRagProject = vi.fn();
    (ragStoreHooks.useUpdateRagProject as any).mockReturnValue(mockUpdateRagProject);
    const updated = { ...mockProject, name: 'Updated' };
    (ragApi.updateProject as any).mockResolvedValue(updated);

    const { result } = renderHook(() => useRagProjects());

    const returnValue = await act(async () => {
      return await result.current.updateProjectById(mockProject.id, { name: 'Updated' });
    });

    expect(ragApi.updateProject).toHaveBeenCalledWith({
      projectId: mockProject.id,
      name: 'Updated',
    });
    expect(mockUpdateRagProject).toHaveBeenCalledWith(mockProject.id, updated);
    expect(returnValue).toEqual(updated);
  });

  it('handles API errors during loadProjects gracefully', async () => {
    (ragStoreHooks.useRagProjects as any).mockReturnValue({});
    (ragStoreHooks.useRagProjectIds as any).mockReturnValue([]);
    (ragStoreHooks.useSetRagProjects as any).mockReturnValue(vi.fn());
    (ragApi.listProjects as any).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useRagProjects());

    await act(async () => {
      await result.current.loadProjects();
    });

    expect(ragApi.listProjects).toHaveBeenCalled();
  });
});
