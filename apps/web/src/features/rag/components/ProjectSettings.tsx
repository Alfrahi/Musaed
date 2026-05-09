'use client';

import { useEffect, useState } from 'react';
import { useRagProjects } from '../hooks/useRagProjects';
import { Loader2, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useActiveRagProject, useLanguage, useOllamaUrl } from '../../../store/hooks';
import { ollamaApi } from '@/lib/ipc';
import { useTranslation } from '@/lib/i18n';

interface ProjectSettingsProps {
  onClose: () => void;
}

interface EmbeddingModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  models: { name: string }[];
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
}

const EmbeddingModelSelect = ({ value, onChange, models, t }: EmbeddingModelSelectProps) => (
  <div className="space-y-1">
    <label className="text-sm font-medium">{t('rag.embeddingModel')}</label>
    {models.length > 0 ? (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
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
        className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
      />
    )}
    <p className="text-muted-foreground text-xs">
      {t('rag.embeddingModelNote', { model: 'nomic-embed-text-v2-moe' })}
    </p>
  </div>
);

const useEmbeddingModels = () => {
  const [embeddingModels, setEmbeddingModels] = useState<{ name: string }[]>([]);
  const ollamaUrl = useOllamaUrl();

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const data = await ollamaApi.getModels(ollamaUrl);
        if (data) setEmbeddingModels(data);
      } catch {
        // IPC layer handles error sanitization
      }
    };
    fetchModels();
  }, [ollamaUrl]);

  return embeddingModels;
};

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
  <div className="flex justify-end gap-2 border-t pt-2">
    <button
      type="button"
      className="hover:bg-accent rounded-md border px-4 py-2 text-sm"
      onClick={onClose}
    >
      {t('common.cancel')}
    </button>
    <button
      type="button"
      className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm disabled:opacity-50"
      onClick={onSave}
      disabled={isSaving}
    >
      {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      {t('common.save')}
    </button>
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
        toast.success(t('rag.embeddingModelUpdated'));
      }
      onClose();
    } catch {
      toast.error(t('rag.failedToUpdateProject'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto">
      <div className="space-y-1">
        <label className="text-sm font-medium">{t('rag.projectName')}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>
      <EmbeddingModelSelect
        value={embeddingModel}
        onChange={setEmbeddingModel}
        models={embeddingModels}
        t={t}
      />
      <div className="space-y-1">
        <label className="text-sm font-medium">{t('rag.ignorePatterns')}</label>
        <textarea
          value={ignorePatterns}
          onChange={(e) => setIgnorePatterns(e.target.value)}
          rows={5}
          placeholder="node_modules\ndist\n.git"
          className="border-input bg-background w-full rounded-md border px-3 py-2 font-mono text-sm"
        />
        <p className="text-muted-foreground text-xs">{t('rag.ignorePatternsDescription')}</p>
      </div>
      <ProjectSettingsActions onClose={onClose} onSave={handleSave} isSaving={isSaving} t={t} />
    </div>
  );
};

const ProjectSettings = ({ onClose }: ProjectSettingsProps) => {
  const activeProject = useActiveRagProject();
  const language = useLanguage();
  const { t } = useTranslation(language);

  if (!activeProject) {
    return <div className="text-muted-foreground p-4 text-sm">{t('rag.noActiveProject')}</div>;
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('rag.projectSettings')}</h2>
        <button type="button" className="hover:bg-accent rounded-md p-1" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <ProjectSettingsForm onClose={onClose} />
    </div>
  );
};

export { ProjectSettings };
