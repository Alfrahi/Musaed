'use client';

import { useEffect, useId, useState } from 'react';
import { useRagProjects } from '@/features/rag/hooks/useRagProjects';
import { Loader2, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useActiveRagProject } from '@/store/rag-store';
import { useLanguage } from '@/store';
import { ragApi } from '@/lib/ipc';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useEmbeddingModels } from '@/features/library';

interface ProjectSettingsProps {
  onClose: () => void;
  /** id to apply to the visible heading so a wrapping ModalLayout's
   *  `aria-labelledby` resolves to this element. If omitted, an internal
   *  id is generated so the dialog still has a stable labelled relationship. */
  titleId?: string;
}

interface EmbeddingModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  models: { name: string }[];
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
}

const EmbeddingModelSelect = ({ value, onChange, models, t }: EmbeddingModelSelectProps) => (
  <div className="space-y-1">
    <label className="text-body font-medium">{t('rag.embeddingModel')}</label>
    {models.length > 0 ? (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-input bg-background text-body w-full rounded-md border px-3 py-2"
      >
        {models.map((m) => (
          <option key={m.name} value={m.name}>
            {m.name}
          </option>
        ))}
        <option value="nomic-embed-text-v2-moe">
          {t('rag.defaultEmbeddingModel', { model: 'nomic-embed-text-v2-moe' })}
        </option>
      </select>
    ) : (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="nomic-embed-text-v2-moe"
        className="border-input bg-background text-body w-full rounded-md border px-3 py-2"
      />
    )}
    <p className="text-muted-foreground text-caption">
      {t('rag.embeddingModelNote', { model: 'nomic-embed-text-v2-moe' })}
    </p>
  </div>
);

const ProjectSettingsActions = ({
  onClose,
  onSave,
  isSaving,
  t,
}: {
  onClose: () => void;
  onSave: () => void;
  isSaving: boolean;
  t: (key: string) => string;
}) => (
  <div className="border-bs flex shrink-0 justify-end gap-2 px-4 py-3">
    <Button variant="outline" className="text-body" onClick={onClose}>
      {t('common.cancel')}
    </Button>
    <Button variant="primary" className="text-body gap-2" onClick={onSave} disabled={isSaving}>
      {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      {t('common.save')}
    </Button>
  </div>
);

const ProjectSettingsForm = ({ onClose }: { onClose: () => void }) => {
  const { updateProjectById } = useRagProjects();
  const activeProject = useActiveRagProject();
  const language = useLanguage();
  const { t } = useTranslation(language);
  const [name, setName] = useState(activeProject?.name ?? '');
  const [ignorePatterns, setIgnorePatterns] = useState('');
  const [embeddingModel, setEmbeddingModel] = useState(activeProject?.embeddingModel ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const embeddingModels = useEmbeddingModels();

  useEffect(() => {
    if (activeProject) {
      setName(activeProject.name);
      setEmbeddingModel(activeProject.embeddingModel);
      setIgnorePatterns(activeProject.ignorePatterns.join('\n'));
    }
  }, [activeProject]);

  const handleSave = async () => {
    if (!activeProject?.id) return;
    setIsSaving(true);
    try {
      const updates: { name?: string; ignorePatterns?: string[] } = {};
      if (name !== activeProject.name) updates.name = name;

      const newPatterns = ignorePatterns
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (JSON.stringify(newPatterns) !== JSON.stringify(activeProject.ignorePatterns)) {
        updates.ignorePatterns = newPatterns;
      }

      if (Object.keys(updates).length > 0) {
        await updateProjectById(activeProject.id, updates);
        toast.success(t('rag.projectUpdated'));
      }

      if (embeddingModel !== activeProject.embeddingModel) {
        const success = await ragApi.setEmbeddingModel(activeProject.id, embeddingModel);
        if (success) {
          toast.success(t('rag.embeddingModelUpdated'));
        } else {
          toast.error(t('error.genericError'));
          setIsSaving(false);
          return;
        }
      }
      onClose();
    } catch {
      toast.error(t('rag.failedToUpdateProject'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
        <div className="space-y-1">
          <label className="text-body font-medium">{t('rag.projectName')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border-input bg-background text-body w-full rounded-md border px-3 py-2"
          />
        </div>
        <EmbeddingModelSelect
          value={embeddingModel}
          onChange={setEmbeddingModel}
          models={embeddingModels}
          t={t}
        />
        <div className="space-y-1">
          <label className="text-body font-medium">{t('rag.ignorePatterns')}</label>
          <textarea
            value={ignorePatterns}
            onChange={(e) => setIgnorePatterns(e.target.value)}
            rows={5}
            placeholder="node_modules\ndist\n.git"
            className="border-input bg-background text-body w-full rounded-md border px-3 py-2 font-mono"
          />
          <p className="text-muted-foreground text-caption">{t('rag.ignorePatternsDescription')}</p>
        </div>
      </div>
      <ProjectSettingsActions onClose={onClose} onSave={handleSave} isSaving={isSaving} t={t} />
    </>
  );
};

const ProjectSettings = ({ onClose, titleId: titleIdProp }: ProjectSettingsProps) => {
  const activeProject = useActiveRagProject();
  const language = useLanguage();
  const { t } = useTranslation(language);
  const generatedTitleId = useId();
  const titleId = titleIdProp ?? generatedTitleId;

  if (!activeProject) {
    return <div className="text-muted-foreground text-body p-4">{t('rag.noActiveProject')}</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-be flex shrink-0 items-center justify-between border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <h2 id={titleId} className="text-heading font-medium">
          {t('rag.projectSettings')}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="hover:bg-accent rounded-md"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ProjectSettingsForm onClose={onClose} />
    </div>
  );
};

export { ProjectSettings };
