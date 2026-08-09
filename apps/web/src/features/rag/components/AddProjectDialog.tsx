'use client';

import { useState, useId, useMemo } from 'react';
import { X, FolderOpen, Loader2, Download } from 'lucide-react';
import { dialogApi } from '@/lib/ipc';
import { useRagProjects as useRagProjectsHook } from '@/features/rag/hooks/useRagProjects';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore, useModelStore } from '@/store';
import { useModelPulling } from '@/features/library';
import { ModalLayout, Input, Textarea, InlineError } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
  const result = await dialogApi.openFile({ directory: true, multiple: false });
  if (result && result.length > 0) {
    const selected = result[0];
    setPath(selected);
    if (!name) {
      const folderName = selected.split('/').pop() || selected.split('\\').pop() || '';
      setName(folderName);
    }
  }
}

function parseIgnorePatterns(raw: string): string[] {
  return raw
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
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
      const patterns = parseIgnorePatterns(form.ignorePatterns);
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
  const models = useModelStore((s) => s.models);
  const embeddingModels = filterEmbeddingModels(models);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const handleAdd = useHandleAdd(form, addNewProject, onAdded, t);
  const titleId = useId();
  const { pullStatus, handlePull } = useModelPulling();

  return (
    <ModalLayout isOpen onClose={onClose} titleId={titleId} maxWidth="max-w-md">
      <div className="bg-background border-border border-be space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">
            {t('rag.addProject')}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="hover:bg-accent rounded"
            aria-label={t('a11y.closeModal')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-muted-foreground text-body">{t('rag.addProjectDescription')}</p>

        <AddProjectFormFields
          form={form}
          embeddingModels={embeddingModels}
          pullStatus={pullStatus}
          handlePull={handlePull}
          handleAdd={handleAdd}
          onClose={onClose}
          t={t}
        />
      </div>
    </ModalLayout>
  );
};

const AddProjectFormFields = ({
  form,
  embeddingModels,
  pullStatus,
  handlePull,
  handleAdd,
  onClose,
  t,
}: {
  form: ReturnType<typeof useFormState>;
  embeddingModels: { name: string }[];
  pullStatus: Record<
    string,
    { status: string; progress?: number; completed?: number; total?: number }
  >;
  handlePull: (name: string) => void;
  handleAdd: () => Promise<void>;
  onClose: () => void;
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
}) => {
  const errorId = useId();
  const isInvalid = !!form.errorMessage;
  const invalidBorder = isInvalid ? 'border-red-500 dark:border-red-400' : undefined;
  const ariaProps: { 'aria-invalid'?: true; 'aria-describedby'?: string } = isInvalid
    ? { 'aria-invalid': true, 'aria-describedby': errorId }
    : {};

  return (
    <>
      <div className="space-y-1">
        <label className="text-body font-medium">{t('rag.projectName')}</label>
        <Input
          type="text"
          value={form.name}
          onChange={(e) => form.setName(e.target.value)}
          placeholder={t('rag.projectName')}
          className={cn('w-full', invalidBorder)}
          {...ariaProps}
        />
      </div>

      <div className="space-y-1">
        <label className="text-body font-medium">{t('rag.projectFolder')}</label>
        <div className="flex gap-2">
          <Input
            type="text"
            value={form.path}
            onChange={(e) => form.setPath(e.target.value)}
            placeholder="/path/to/project"
            className={cn('flex-1', invalidBorder)}
            {...ariaProps}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => browseFolder(form.setPath, form.setName, form.name)}
            className="gap-1"
          >
            <FolderOpen className="h-4 w-4" />
            {t('rag.browse')}
          </Button>
        </div>
      </div>

      <EmbeddingModelSelect
        value={form.embeddingModel}
        onChange={form.setEmbeddingModel}
        models={embeddingModels}
        t={t}
        pullStatus={pullStatus}
        onPullModel={handlePull}
        invalidBorder={invalidBorder}
        ariaProps={ariaProps}
      />

      <div className="space-y-1">
        <label className="text-body font-medium">{t('rag.ignorePatterns')}</label>
        <Textarea
          value={form.ignorePatterns}
          onChange={(e) => form.setIgnorePatterns(e.target.value)}
          rows={3}
          placeholder="node_modules&#10;dist&#10;.git"
          className="w-full font-mono"
        />
        <p className="text-muted-foreground text-caption">{t('rag.ignorePatternsDescription')}</p>
      </div>

      {form.errorMessage && (
        <div id={errorId}>
          <InlineError message={form.errorMessage} />
        </div>
      )}

      <FormActions onClose={onClose} handleAdd={handleAdd} isAdding={form.isAdding} t={t} />
    </>
  );
};

const FormActions = ({
  onClose,
  handleAdd,
  isAdding,
  t,
}: {
  onClose: () => void;
  handleAdd: () => Promise<void>;
  isAdding: boolean;
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
}) => (
  <div className="pbs-2 flex justify-end gap-2">
    <Button variant="outline" onClick={onClose} className="text-body">
      {t('common.cancel')}
    </Button>
    <Button variant="primary" onClick={handleAdd} disabled={isAdding} className="text-body gap-2">
      {isAdding && <Loader2 className="h-4 w-4 animate-spin" />}
      {t('rag.addProjectAction')}
    </Button>
  </div>
);

const EmbeddingModelSelect = ({
  value,
  onChange,
  models,
  t,
  pullStatus,
  onPullModel,
  invalidBorder,
  ariaProps,
}: {
  value: string;
  onChange: (v: string) => void;
  models: { name: string }[];
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
  pullStatus: Record<
    string,
    { status: string; progress?: number; completed?: number; total?: number }
  >;
  onPullModel: (name: string) => void;
  invalidBorder?: string;
  ariaProps?: { 'aria-invalid'?: true; 'aria-describedby'?: string };
}) => {
  const installedModelNames = useMemo(() => new Set(models.map((m) => m.name)), [models]);
  const isInstalled = installedModelNames.has(value);
  const isPulling = !!pullStatus[value];

  return (
    <div className="space-y-1">
      <label className="text-body font-medium">{t('rag.embeddingModel')}</label>
      {models.length > 0 ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'border-input bg-background text-body w-full rounded-md border px-3 py-2',
            invalidBorder
          )}
          {...ariaProps}
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
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="nomic-embed-text-v2-moe"
          className={cn('w-full', invalidBorder)}
          {...ariaProps}
        />
      )}

      {!isInstalled && value.trim() && (
        <div className="pbs-1 flex items-center gap-2">
          <p className="text-caption text-amber-600 dark:text-amber-400">
            {t('rag.modelMissing', { model: value })}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onPullModel(value)}
            disabled={isPulling}
            className="text-caption gap-1 rounded-md bg-amber-100 font-medium text-amber-700 hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50"
          >
            {isPulling ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t('library.pulling')}
              </>
            ) : (
              <>
                <Download size={14} />
                {t('rag.pullModel')}
              </>
            )}
          </Button>
        </div>
      )}

      <p className="text-muted-foreground text-caption">
        {t('rag.embeddingModelNote', { model: 'nomic-embed-text-v2-moe' })}
      </p>
    </div>
  );
};
