'use client';

import { useState, useMemo, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso';
import { useUIStore } from '@/store/ui-store';
import { useModelStore, useModelFetchError } from '@/store/model-store';
import { useSettingsStore } from '@/store';
import { useTranslation } from '@/lib/i18n';
import ModelCard from './ModelCard';
import LibrarySearchHeader from './LibrarySearchHeader';
import { useModelPulling } from '@/features/library/hooks/useModelPulling';
import { useModelActions } from '@/features/library/hooks/useModelActions';
import { dialog } from '@/lib/ipc';
import { ErrorFallback } from '@/components/ui';
import { cn } from '@/lib/utils';
import { ModalLayout } from '@/components/ui';
import type { Language } from '@musaed/contracts';

interface ModelLibraryProps {
  isOpen: boolean;
  onClose: () => void;
}

const FEATURED_MODELS_LIST = [
  { name: 'deepseek-r1:1.5b', descriptionKey: 'models.deepseekR1_15b' as const, size: 1.1 },
  { name: 'deepseek-r1:7b', descriptionKey: 'models.deepseekR1_7b' as const, size: 4.7 },
  { name: 'llama3.2', descriptionKey: 'models.llama32' as const, size: 2.0 },
  { name: 'llama3.1', descriptionKey: 'models.llama31' as const, size: 4.7 },
  { name: 'mistral', descriptionKey: 'models.mistral' as const, size: 4.1 },
  { name: 'phi3', descriptionKey: 'models.phi3' as const, size: 2.3 },
  { name: 'gemma2', descriptionKey: 'models.gemma2' as const, size: 5.4 },
  { name: 'llava', descriptionKey: 'models.llava' as const, size: 4.5 },
  { name: 'codellama', descriptionKey: 'models.codellama' as const, size: 3.8 },
  { name: 'qwen2.5', descriptionKey: 'models.qwen25' as const, size: 4.4 },
];

/** Featured models grid with virtualization. */
const FeaturedGrid = ({
  models,
  filteredFeatured,
  pullStatus,
  handlePull,
  translateOllamaStatus,
  language,
}: {
  models: { name: string }[];
  filteredFeatured: ((typeof FEATURED_MODELS_LIST)[number] & { description: string })[];
  pullStatus: Record<string, { status: string }>;
  handlePull: (name: string) => void;
  translateOllamaStatus: (s: string) => string;
  language: Language;
}) => (
  <VirtuosoGrid
    style={{ height: '100%' }}
    data={filteredFeatured}
    totalCount={filteredFeatured.length}
    listClassName="grid grid-cols-1 md:grid-cols-2 gap-4 p-6"
    itemContent={(_idx, model) => (
      <ModelCard
        key={model.name}
        name={model.name}
        description={model.description}
        size={model.size * 1024 * 1024 * 1024}
        isDownloaded={models.some((m) => m.name.startsWith(model.name))}
        pullStatus={
          pullStatus[model.name]
            ? {
                ...pullStatus[model.name],
                status: translateOllamaStatus(pullStatus[model.name].status),
              }
            : undefined
        }
        onPull={handlePull}
        language={language}
      />
    )}
  />
);

/** Installed models list with virtualization. */
const InstalledList = ({
  filteredInstalled,
  handleDelete,
  language,
}: {
  filteredInstalled: {
    name: string;
    size?: number | null;
    details?: {
      parameterSize?: string | null;
      quantizationLevel?: string | null;
      family?: string | null;
    } | null;
  }[];
  handleDelete: (name: string) => void;
  language: Language;
}) => (
  <Virtuoso
    style={{ height: '100%' }}
    data={filteredInstalled}
    itemContent={(idx, model) => (
      <div
        className={cn(
          'pbe-4 ps-6 pe-6',
          idx === 0 && 'pbs-6',
          idx === filteredInstalled.length - 1 && 'pbe-12'
        )}
      >
        <ModelCard
          name={model.name}
          size={model.size}
          details={model.details || undefined}
          isDownloaded={true}
          onDelete={handleDelete}
          language={language}
          variant="installed"
        />
      </div>
    )}
  />
);

/** Connection warning banner. */
const ConnectionWarning = ({ message }: { message: string }) => (
  <div className="mbs-4 ms-6 me-6 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
    <AlertCircle size={18} className="shrink-0 text-amber-600 dark:text-amber-400" />
    <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{message}</p>
  </div>
);

/** Footer with storage info and close button. */
const LibraryFooter = ({
  storageLabel,
  closeLabel,
  onClose,
}: {
  storageLabel: string;
  closeLabel: string;
  onClose: () => void;
}) => (
  <div className="border-bs flex items-center justify-between border-zinc-100 bg-zinc-50 py-4 ps-6 pe-6 dark:border-zinc-800 dark:bg-zinc-900/80">
    <span className="text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
      {storageLabel}
    </span>
    <button
      onClick={onClose}
      className="h-10 rounded-lg bg-zinc-900 ps-6 pe-6 text-xs font-bold tracking-widest text-white uppercase shadow-sm transition-all hover:opacity-90 active:scale-95 dark:bg-zinc-100 dark:text-zinc-900"
    >
      {closeLabel}
    </button>
  </div>
);

const ModelLibrary = ({ isOpen, onClose }: ModelLibraryProps) => {
  const models = useModelStore((s) => s.models);
  const pullStatus = useModelStore((s) => s.pullStatus);
  const fetchError = useModelFetchError();
  const isOllamaConnected = useUIStore((s) => s.isOllamaConnected);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { fetchModels, deleteModel } = useModelActions();
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'featured' | 'installed'>('featured');
  const { t } = useTranslation(language);
  const { handlePull, translateOllamaStatus } = useModelPulling();

  const featuredModels = useMemo(
    () => FEATURED_MODELS_LIST.map((m) => ({ ...m, description: t(m.descriptionKey) })),
    [t]
  );

  const handleDelete = useCallback(
    async (name: string) => {
      const confirmed = await dialog.ask(t('library.confirmDeleteNamed', { name }), {
        title: t('library.deleteModel'),
        kind: 'warning',
      });
      if (confirmed) await deleteModel(name);
    },
    [deleteModel, t]
  );

  const filteredFeatured = useMemo(
    () =>
      featuredModels.filter(
        (m) =>
          m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.description?.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [featuredModels, searchQuery]
  );

  const filteredInstalled = useMemo(
    () =>
      models.filter((m: { name: string }) =>
        m.name.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [models, searchQuery]
  );

  return (
    <ModalLayout isOpen={isOpen} onClose={onClose} maxWidth="max-w-4xl" className="h-[85vh]">
      <LibrarySearchHeader
        language={language}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        isRefreshing={isRefreshing}
        onRefresh={() => fetchModels(true)}
        onClose={onClose}
        installedCount={models.length}
        onPullAny={handlePull}
      />

      {!isOllamaConnected && <ConnectionWarning message={t('chat.connectionFailed')} />}

      <div className="flex-1 overflow-hidden bg-white dark:bg-zinc-950/20">
        {fetchError && !isOllamaConnected ? (
          <div className="flex h-full items-center justify-center">
            <ErrorFallback
              type="ollama"
              description={fetchError}
              onRetry={() => fetchModels(true)}
            />
          </div>
        ) : activeTab === 'featured' ? (
          <FeaturedGrid
            models={models}
            filteredFeatured={filteredFeatured}
            pullStatus={pullStatus}
            handlePull={handlePull}
            translateOllamaStatus={translateOllamaStatus}
            language={language}
          />
        ) : (
          <InstalledList
            filteredInstalled={filteredInstalled}
            handleDelete={handleDelete}
            language={language}
          />
        )}
      </div>

      <LibraryFooter
        storageLabel={t('logs.logStorageInfo')}
        closeLabel={t('common.done')}
        onClose={onClose}
      />
    </ModalLayout>
  );
};

export default ModelLibrary;
