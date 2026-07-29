'use client';

import { useEffect, useCallback } from 'react';
import { ragApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';
import {
  useRagProjects as useRagProjectsFromStore,
  useRagProjectIds,
  useSetRagProjects,
  useAddRagProject,
  useRemoveRagProject,
  useUpdateRagProject,
} from '@/store/rag-store';

export function useRagProjects() {
  const projects = useRagProjectsFromStore();
  const projectIds = useRagProjectIds();
  const setProjects = useSetRagProjects();
  const addProject = useAddRagProject();
  const removeProject = useRemoveRagProject();
  const updateProject = useUpdateRagProject();

  const loadProjects = useCallback(async () => {
    try {
      const result = await ragApi.listProjects();
      if (result) {
        setProjects(result);
      }
    } catch (err) {
      logger.error('Failed to load projects:', { error: String(err) });
    }
  }, [setProjects]);

  const addNewProject = useCallback(
    async (args: {
      name: string;
      path: string;
      embeddingModel: string;
      ignorePatterns: string[];
    }) => {
      const result = await ragApi.addProject(args);
      if (result) {
        addProject(result);
      }
      return result;
    },
    [addProject]
  );

  const removeProjectById = useCallback(
    async (projectId: string) => {
      const result = await ragApi.removeProject(projectId);
      if (result) {
        removeProject(projectId);
      }
      return result;
    },
    [removeProject]
  );

  const updateProjectById = useCallback(
    async (projectId: string, updates: { name?: string; ignorePatterns?: string[] }) => {
      const result = await ragApi.updateProject({ projectId, ...updates });
      if (result) {
        updateProject(projectId, result);
      }
      return result;
    },
    [updateProject]
  );

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return {
    projects,
    projectIds,
    loadProjects,
    addNewProject,
    removeProjectById,
    updateProjectById,
  };
}
