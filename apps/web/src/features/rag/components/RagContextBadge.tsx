'use client';

import { FolderOpen, X } from 'lucide-react';
import { useActiveRagProject, useSetActiveRagProjectId, useLanguage } from '@/store/hooks';
import { useTranslation } from '@/lib/i18n';

export const RagContextBadge = () => {
  const activeProject = useActiveRagProject();
  const setActiveProjectId = useSetActiveRagProjectId();
  const language = useLanguage();
  const { t } = useTranslation(language);

  if (!activeProject) return null;

  return (
    <div className="bg-accent/50 flex items-center gap-1 rounded-md px-2 py-0.5 text-xs">
      <FolderOpen className="text-muted-foreground h-3 w-3" />
      <span className="text-muted-foreground">{activeProject.name}</span>
      <button
        onClick={() => setActiveProjectId(null)}
        className="hover:bg-accent text-muted-foreground hover:text-foreground rounded p-0.5"
        title={t('rag.deactivateRag')}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
};
