'use client';

import { memo, useState, useEffect } from 'react';
import {
  FolderOpen,
  Trash2,
  RefreshCw,
  Database,
  X,
  Check,
  FolderTree,
  Settings2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { IndexingProgress } from './IndexingProgress';
import { RagExplorer } from './RagExplorer';
import { ProjectSettings } from './ProjectSettings';
import type { RagProject, IndexProgress as IndexProgressType } from '@musaed/contracts';
import { listen } from '@/lib/ipc';
import { IndexProgressSchema } from '@musaed/contracts';
import { truncateFilePath } from '../utils/project-helpers';
import { useSettingsStore } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import ModalLayout from '@/components/ui/ModalLayout';

interface ProjectCardProps {
  project: RagProject;
  isActive: boolean;
  onSelect: () => void;
  onIndex: () => void;
  onReindex: () => void;
  onRetry?: () => void;
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
  onRetry,
  onAbort,
  onRemove,
}: ProjectCardProps) => {
  const isIndexing = project.status === 'indexing';
  const indexProgress = useProjectIndexProgress(project.id);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <div
      className={cn(
        'group mbe-0.5 flex cursor-pointer flex-col rounded-md px-2 py-1.5 transition-colors',
        isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50 text-foreground'
      )}
      onClick={onSelect}
    >
      <ProjectHeader project={project} isActive={isActive} onSelect={onSelect} t={t} />
      <ProjectStats project={project} t={t} />
      {isIndexing && indexProgress && (
        <IndexingProgress progress={indexProgress} onAbort={onAbort} onRetry={onRetry} />
      )}
      <ProjectActions
        project={project}
        isIndexing={isIndexing}
        onIndex={onIndex}
        onReindex={onReindex}
        onAbort={onAbort}
        onRemove={onRemove}
        onBrowseFiles={() => setIsExplorerOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        t={t}
      />

      {isExplorerOpen && (
        <ExplorerModal
          project={project}
          onClose={() => setIsExplorerOpen(false)}
          titleId="rag-explorer-title"
          t={t}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal
          project={project}
          onClose={() => setIsSettingsOpen(false)}
          titleId="rag-settings-title"
          t={t}
        />
      )}
    </div>
  );
};

export default memo(ProjectCard);

const ProjectHeader = ({
  project,
  isActive,
  onSelect,
  t,
}: {
  project: RagProject;
  isActive: boolean;
  onSelect: () => void;
  t: (key: string) => string;
}) => {
  return (
    <div className="flex items-center gap-2">
      <FolderOpen className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-body truncate font-medium">{project.name}</p>
        <p className="text-muted-foreground text-caption truncate">
          {truncateFilePath(project.path)}
        </p>
      </div>
      {isActive && (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          aria-label={t('a11y.deselectProject')}
          title={t('a11y.deselectProject')}
        >
          <Check className="h-3 w-3" />
        </Button>
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
    <div className="text-muted-foreground text-caption mbs-1 flex items-center gap-2">
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

type ReadyActionsProps = {
  project: RagProject;
  onReindex: () => void;
  onBrowseFiles: () => void;
  onOpenSettings: () => void;
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
};

/** Action buttons shown only for `status === 'ready'` projects. Extracted
 *  out of `ProjectActions` so that component stays under the project's
 *  `max-lines-per-function` lint gate (STANDARDS §11).
 *  Browse Files + Settings buttons open `RagExplorer` / `ProjectSettings`
 *  in a `ModalLayout` mounted by the parent `ProjectCard`. The unconditional
 *  Remove button is rendered separately by `ProjectActions` (it applies to
 *  every status, not just `ready`). */
const ReadyActions = ({
  project,
  onReindex,
  onBrowseFiles,
  onOpenSettings,
  t,
}: ReadyActionsProps) => (
  <>
    <button
      onClick={(e) => {
        e.stopPropagation();
        onReindex();
      }}
      className="text-muted-foreground hover:text-foreground text-caption flex cursor-pointer items-center gap-0.5"
      title={t('rag.reindexProject')}
    >
      <RefreshCw className="h-3 w-3" /> {t('rag.reindexProject')}
    </button>
    <Button
      variant="ghost"
      size="icon"
      onClick={(e) => {
        e.stopPropagation();
        onBrowseFiles();
      }}
      aria-label={t('a11y.browseFiles', { name: project.name })}
      title={t('a11y.browseFiles', { name: project.name })}
      className="text-muted-foreground hover:text-foreground cursor-pointer"
    >
      <FolderTree className="h-3 w-3" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      onClick={(e) => {
        e.stopPropagation();
        onOpenSettings();
      }}
      aria-label={t('a11y.projectSettings', { name: project.name })}
      title={t('a11y.projectSettings', { name: project.name })}
      className="text-muted-foreground hover:text-foreground cursor-pointer"
    >
      <Settings2 className="h-3 w-3" />
    </Button>
  </>
);

type ProjectActionsProps = {
  project: RagProject;
  isIndexing: boolean;
  onIndex: () => void;
  onReindex: () => void;
  onRetry?: () => void;
  onAbort: () => void;
  onRemove: () => void;
  onBrowseFiles: () => void;
  onOpenSettings: () => void;
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
};

const ProjectActions = ({
  project,
  isIndexing,
  onIndex,
  onReindex,
  onRetry,
  onAbort,
  onRemove,
  onBrowseFiles,
  onOpenSettings,
  t,
}: ProjectActionsProps) => {
  return (
    <div
      className={cn(
        'mbs-1 flex items-center gap-1',
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
          className="text-muted-foreground hover:text-foreground text-caption flex cursor-pointer items-center gap-0.5"
          title={t('rag.indexProject')}
        >
          <RefreshCw className="h-3 w-3" /> {t('rag.indexProject')}
        </button>
      )}
      {!isIndexing && project.status === 'ready' && (
        <ReadyActions
          project={project}
          onReindex={onReindex}
          onBrowseFiles={onBrowseFiles}
          onOpenSettings={onOpenSettings}
          t={t}
        />
      )}
      {!isIndexing && project.status === 'error' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRetry?.();
          }}
          className="text-muted-foreground hover:text-foreground text-caption flex cursor-pointer items-center gap-0.5"
          title={t('rag.retryIndexing')}
        >
          <RefreshCw className="h-3 w-3" /> {t('rag.retry')}
        </button>
      )}
      {isIndexing && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAbort();
          }}
          className="text-caption flex cursor-pointer items-center gap-0.5 text-red-400 hover:text-red-300"
          title={t('rag.cancelIndexing')}
        >
          <X className="h-3 w-3" /> {t('common.cancel')}
        </button>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="text-muted-foreground ms-auto cursor-pointer hover:text-red-400"
        title={t('rag.removeProject')}
        aria-label={t('a11y.removeProject')}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
};

type ExplorerModalProps = {
  project: RagProject;
  onClose: () => void;
  titleId: string;
  t: (key: string) => string;
};

const ExplorerModal = ({ project, onClose, titleId, t }: ExplorerModalProps) => (
  <ModalLayout isOpen onClose={onClose} titleId={titleId} maxWidth="max-w-4xl" className="h-[80vh]">
    <div className="flex h-full flex-col">
      <div className="border-sidebar-border border-be flex items-center justify-between px-4 py-3">
        <h2 id={titleId} className="text-heading font-medium">
          {project.name}
        </h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('a11y.closeModal')}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-hidden">
        <RagExplorer />
      </div>
    </div>
  </ModalLayout>
);

type SettingsModalProps = {
  project: RagProject;
  onClose: () => void;
  titleId: string;
  t: (key: string) => string;
};

const SettingsModal = ({ project: _project, onClose, titleId, t: _t }: SettingsModalProps) => (
  <ModalLayout isOpen onClose={onClose} titleId={titleId} maxWidth="max-w-2xl" className="h-[70vh]">
    <ProjectSettings onClose={onClose} titleId={titleId} />
  </ModalLayout>
);
