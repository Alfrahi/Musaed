'use client';

import { useState } from 'react';
import { X, FolderOpen, Loader2 } from 'lucide-react';
import { dialog } from '@/lib/ipc';
import { useRagProjects as useRagProjectsHook } from '../hooks/useRagProjects';
import { useTranslation } from '@/lib/i18n';
import { useLanguage, useModels } from '@/store/hooks';

interface AddProjectDialogProps {
  onClose: () => void;
  onAdded: () => void;
}

function filterEmbeddingModels(models: { name: string }[]) {
  return models.filter(
    (m) =>
      m.name.toLowerCase().includes('embed') ||
      m.name.toLowerCase().includes('e5') ||
      m.name.toLowerCase().includes('bge')
  );
}

function useFormState() {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [embeddingModel, setEmbeddingModel] = useState('nomic-embed-text-v2-moe');
  const [ignorePatterns, setIgnorePatterns] = useState('node_modules\ndist\n.git');
  const [isAdding, setIsAdding] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  return {
    name,
    setName,
    path,
    setPath,
    embeddingModel,
    setEmbeddingModel,
    ignorePatterns,
    setIgnorePatterns,
    isAdding,
    setIsAdding,
    errorMessage,
    setErrorMessage,
  };
}

async function browseFolder(
  setPath: (p: string) => void,
  setName: (n: string) => void,
  name: string
) {
  const selected = await dialog.open({ directory: true, multiple: false });
  if (selected && typeof selected === 'string') {
    setPath(selected);
    if (!name) {
      const folderName = selected.split('/').pop() || selected.split('\\').pop() || '';
      setName(folderName);
    }
  }
}

function useHandleAdd(
  form: ReturnType<typeof useFormState>,
  addNewProject: (data: {
    name: string;
    path: string;
    embeddingModel: string;
    ignorePatterns: string[];
  }) => Promise<unknown>,
  onAdded: () => void,
  t: (key: string) => string
) {
  return async () => {
    if (!form.name.trim() || !form.path.trim() || !form.embeddingModel.trim()) {
      form.setErrorMessage(t('rag.requiredFieldsError'));
      return;
    }

    form.setIsAdding(true);
    form.setErrorMessage(null);

    try {
      const patterns = form.ignorePatterns
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      const result = await addNewProject({
        name: form.name.trim(),
        path: form.path.trim(),
        embeddingModel: form.embeddingModel.trim(),
        ignorePatterns: patterns,
      });
      if (result) onAdded();
    } catch (e) {
      form.setErrorMessage(e instanceof Error ? e.message : t('rag.failedToUpdateProject'));
    } finally {
      form.setIsAdding(false);
    }
  };
}

export const AddProjectDialog = ({ onClose, onAdded }: AddProjectDialogProps) => {
  const form = useFormState();
  const { addNewProject } = useRagProjectsHook();
  const models = useModels();
  const embeddingModels = filterEmbeddingModels(models);
  const language = useLanguage();
  const { t } = useTranslation(language);
  const handleAdd = useHandleAdd(form, addNewProject, onAdded, t);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-background border-border w-full max-w-md space-y-4 rounded-lg border p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('rag.addProject')}</h2>
          <button onClick={onClose} className="hover:bg-accent rounded p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-muted-foreground text-sm">{t('rag.addProjectDescription')}</p>

        <div className="space-y-1">
          <label className="text-sm font-medium">{t('rag.projectName')}</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => form.setName(e.target.value)}
            placeholder={t('rag.projectName')}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">{t('rag.projectFolder')}</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={form.path}
              onChange={(e) => form.setPath(e.target.value)}
              placeholder="/path/to/project"
              className="border-input bg-background flex-1 rounded-md border px-3 py-2 text-sm"
            />
            <button
              onClick={() => browseFolder(form.setPath, form.setName, form.name)}
              className="border-input bg-background hover:bg-accent flex items-center gap-1 rounded-md border px-3 py-2 text-sm"
            >
              <FolderOpen className="h-4 w-4" />
              {t('rag.browse')}
            </button>
          </div>
        </div>

        <EmbeddingModelSelect
          value={form.embeddingModel}
          onChange={form.setEmbeddingModel}
          models={embeddingModels}
          t={t}
        />

        <div className="space-y-1">
          <label className="text-sm font-medium">{t('rag.ignorePatterns')}</label>
          <textarea
            value={form.ignorePatterns}
            onChange={(e) => form.setIgnorePatterns(e.target.value)}
            rows={3}
            placeholder="node_modules&#10;dist&#10;.git"
            className="border-input bg-background w-full rounded-md border px-3 py-2 font-mono text-sm"
          />
          <p className="text-muted-foreground text-xs">{t('rag.ignorePatternsDescription')}</p>
        </div>

        {form.errorMessage && <p className="text-sm text-red-500">{form.errorMessage}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="border-input bg-background hover:bg-accent rounded-md border px-4 py-2 text-sm"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleAdd}
            disabled={form.isAdding}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-md px-4 py-2 text-sm disabled:opacity-50"
          >
            {form.isAdding && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('rag.addProjectAction')}
          </button>
        </div>
      </div>
    </div>
  );
};

const EmbeddingModelSelect = ({
  value,
  onChange,
  models,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  models: { name: string }[];
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
}) => {
  return (
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
};
