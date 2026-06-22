'use client';

import { memo, useState, useEffect } from 'react';
import { FolderOpen, Trash2, RefreshCw, Database, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IndexingProgress } from './IndexingProgress';
import type { RagProject, IndexProgress as IndexProgressType } from '@musaed/contracts';
import { listen } from '@/lib/ipc';
import { IndexProgressSchema } from '@musaed/contracts';
import { truncateFilePath } from '@/features/rag/utils/project-helpers';
import { useSettingsStore } from '@/features/settings';
import { useTranslation } from '@/lib/i18n';

interface ProjectCardProps {
  project: RagProject;
  isActive: boolean;
  onSelect: () => void;
  onIndex: () => void;
  onReindex: () => void;
  onAbort: () => void;
  onRemove: () => void;
}

function useProjectIndexProgress(projectId: string) {
  const [indexProgress, setIndexProgress] = useState<IndexProgressType | null>(null);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      unlisten = await listen<IndexProgressType>(
        'rag-index-progress',
        (payload) => {
          if (payload.projectId === projectId) setIndexProgress(payload);
        },
        IndexProgressSchema
      );
    };
    setup();
    return () => {
      unlisten?.();
    };
  }, [projectId]);
  return indexProgress;
}

const ProjectCard = ({
  project,
  isActive,
  onSelect,
  onIndex,
  onReindex,
  onAbort,
  onRemove,
}: ProjectCardProps) => {
  const isIndexing = project.status === 'indexing';
  const indexProgress = useProjectIndexProgress(project.id);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);

  return (
    <div
      className={cn(
        'group mb-0.5 flex cursor-pointer flex-col rounded-md px-2 py-1.5 transition-colors',
        isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50 text-foreground'
      )}
      onClick={onSelect}
    >
      <ProjectHeader project={project} isActive={isActive} onSelect={onSelect} />
      <ProjectStats project={project} t={t} />
      {isIndexing && indexProgress && (
        <IndexingProgress progress={indexProgress} onAbort={onAbort} />
      )}
      <ProjectActions
        project={project}
        isIndexing={isIndexing}
        onIndex={onIndex}
        onReindex={onReindex}
        onAbort={onAbort}
        onRemove={onRemove}
        t={t}
      />
    </div>
  );
};

export default memo(ProjectCard);

const ProjectHeader = ({
  project,
  isActive,
  onSelect,
}: {
  project: RagProject;
  isActive: boolean;
  onSelect: () => void;
}) => {
  return (
    <div className="flex items-center gap-2">
      <FolderOpen className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{project.name}</p>
        <p className="text-muted-foreground truncate text-xs">{truncateFilePath(project.path)}</p>
      </div>
      {isActive && (
        <X
          className="text-muted-foreground hover:text-foreground h-3 w-3 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        />
      )}
    </div>
  );
};

const ProjectStats = ({
  project,
  t,
}: {
  project: RagProject;
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
}) => {
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { formatFileSize } = useTranslation(language);

  return (
    <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
      {project.chunkCount > 0 && (
        <>
          <span className="flex items-center gap-0.5">
            <Database className="h-3 w-3" />
            {t('rag.chunks', { count: project.chunkCount })}
          </span>
          <span>·</span>
          <span>{formatFileSize(project.totalBytes)}</span>
        </>
      )}
      {project.status === 'ready' && <span className="text-green-500">{t('rag.indexed')}</span>}
      {project.status === 'error' && <span className="text-red-500">{t('rag.error')}</span>}
    </div>
  );
};

const ProjectActions = ({
  project,
  isIndexing,
  onIndex,
  onReindex,
  onAbort,
  onRemove,
  t,
}: {
  project: RagProject;
  isIndexing: boolean;
  onIndex: () => void;
  onReindex: () => void;
  onAbort: () => void;
  onRemove: () => void;
  t: (key: string) => string;
}) => {
  return (
    <div
      className={cn(
        'mt-1 flex items-center gap-1',
        isIndexing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        'transition-opacity'
      )}
    >
      {!isIndexing && project.status === 'idle' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onIndex();
          }}
          className="text-muted-foreground hover:text-foreground flex items-center gap-0.5 text-xs"
          title={t('rag.indexProject')}
        >
          <RefreshCw className="h-3 w-3" /> {t('rag.indexProject')}
        </button>
      )}
      {!isIndexing && project.status === 'ready' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onReindex();
          }}
          className="text-muted-foreground hover:text-foreground flex items-center gap-0.5 text-xs"
          title={t('rag.reindexProject')}
        >
          <RefreshCw className="h-3 w-3" /> {t('rag.reindexProject')}
        </button>
      )}
      {isIndexing && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAbort();
          }}
          className="flex items-center gap-0.5 text-xs text-red-400 hover:text-red-300"
          title={t('rag.cancelIndexing')}
        >
          <X className="h-3 w-3" /> {t('common.cancel')}
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="text-muted-foreground ms-auto flex items-center gap-0.5 text-xs hover:text-red-400"
        title={t('rag.removeProject')}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
};
