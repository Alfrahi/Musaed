'use client';

import { Plus } from 'lucide-react';
import { useRagProjects as useRagProjectsHook } from '../hooks/useRagProjects';
import { useRagIndexing } from '../hooks/useRagIndexing';
import { useActiveRagProjectId, useSetActiveRagProjectId } from '@/store/hooks';
import { ProjectCard } from './ProjectCard';
import { AddProjectDialog } from './AddProjectDialog';
import { useState, useEffect } from 'react';

export const ProjectList = ({ hideHeaderAction = false }: { hideHeaderAction?: boolean }) => {
  const { projects, projectIds, removeProjectById } = useRagProjectsHook();
  const { startIndexing, abortIndexing, startIndexEventListeners } = useRagIndexing();
  const activeProjectId = useActiveRagProjectId();
  const setActiveProjectId = useSetActiveRagProjectId();
  const [showAddDialog, setShowAddDialog] = useState(false);

  // Start event listeners for indexing progress
  useEffect(() => {
    const cleanup = startIndexEventListeners();
    return cleanup;
  }, [startIndexEventListeners]);

  const handleIndex = (projectId: string) => {
    startIndexing(projectId);
  };

  const handleReindex = (projectId: string) => {
    startIndexing(projectId, true);
  };

  const handleRemove = async (projectId: string) => {
    await removeProjectById(projectId);
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
    }
  };

  return (
    <div className="space-y-1">
      {!hideHeaderAction && (
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            RAG Projects
          </span>
          <button
            onClick={() => setShowAddDialog(true)}
            className="hover:bg-accent text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
            title="Add project"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {projectIds.length === 0 ? (
        <p className="text-muted-foreground px-2 text-xs italic">No projects added yet</p>
      ) : (
        <div className="space-y-0.5">
          {projectIds.map((id: string) => {
            const project = projects[id];
            if (!project) return null;
            return (
              <ProjectCard
                key={id}
                project={project}
                isActive={activeProjectId === id}
                onSelect={() => setActiveProjectId(activeProjectId === id ? null : id)}
                onIndex={() => handleIndex(id)}
                onReindex={() => handleReindex(id)}
                onAbort={() => abortIndexing(id)}
                onRemove={() => handleRemove(id)}
              />
            );
          })}
        </div>
      )}

      {showAddDialog && (
        <AddProjectDialog
          onClose={() => setShowAddDialog(false)}
          onAdded={() => setShowAddDialog(false)}
        />
      )}
    </div>
  );
};
