'use client';

import { useState } from 'react';
import { FolderOpen, Plus, X } from 'lucide-react';
import { useActiveRagProject, useSetActiveRagProjectId } from '@/store/rag-store';
import { useSetSidebarTab, useSettingsStore } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { RagExplorer } from '@/features/rag';
import ModalLayout from '@/components/ui/ModalLayout';

/**
 * RAG context indicator that lives in the chat compose surface.
 *
 * Mounted at `components/ui` (not the `rag` feature) so that the conversation
 * feature can use it without crossing the feature boundary (STANDARDS §3).
 * Two states:
 *
 *  - inactive: a "Add RAG Project" pill button that routes the user to the
 *    sidebar Projects tab via the shared `useSetSidebarTab` action.
 *  - active: a project-name button that opens `RagExplorer` in a
 *    `ModalLayout`, plus a deactivate (X) affordance.
 */
export const RagContextBadge = () => {
  const activeProject = useActiveRagProject();
  const setActiveProjectId = useSetActiveRagProjectId();
  const setSidebarTab = useSetSidebarTab();
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);

  if (!activeProject) {
    return (
      <button
        type="button"
        onClick={() => setSidebarTab('projects')}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors"
        aria-label={t('rag.addProject')}
      >
        <Plus className="h-3 w-3" />
        <span>{t('rag.addProject')}</span>
      </button>
    );
  }

  const titleId = 'rag-explorer-title';
  return (
    <>
      <div className="bg-accent/50 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs">
        <FolderOpen className="text-muted-foreground h-3 w-3" />
        <button
          type="button"
          onClick={() => setIsExplorerOpen(true)}
          className="text-muted-foreground hover:text-foreground truncate font-medium transition-colors"
          title={t('rag.title')}
        >
          {activeProject.name}
        </button>
        <button
          type="button"
          onClick={() => setActiveProjectId(null)}
          className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-0.5"
          aria-label={t('rag.deactivateRag')}
          title={t('rag.deactivateRag')}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>

      {isExplorerOpen && (
        <ModalLayout
          isOpen={isExplorerOpen}
          onClose={() => setIsExplorerOpen(false)}
          titleId={titleId}
          maxWidth="max-w-4xl"
          className="h-[80vh]"
        >
          <div className="flex h-full flex-col">
            <div className="border-sidebar-border flex items-center justify-between border-b px-4 py-3">
              <h2 id={titleId} className="text-base font-medium">
                {activeProject.name}
              </h2>
              <button
                type="button"
                className="hover:bg-accent rounded-md p-1"
                onClick={() => setIsExplorerOpen(false)}
                aria-label={t('a11y.closeModal')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <RagExplorer />
            </div>
          </div>
        </ModalLayout>
      )}
    </>
  );
};
