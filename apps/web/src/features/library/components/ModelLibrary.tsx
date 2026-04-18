"use client";

import { useState, useMemo, useCallback } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso';
import { useModelStore, useSettingsStore, useUIStore } from '../../../store';
import { useTranslation, TranslationKey } from '../../../lib/i18n';
import ModelCard from './ModelCard';
import LibrarySearchHeader from './LibrarySearchHeader';
import { useModelPulling } from '../hooks/useModelPulling';
import { useModelActions } from '../hooks/useModelActions';
import { dialog } from '../../../lib/ipc';
import { cn } from '../../../lib/utils';
import { ModalLayout } from '../../layout';

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

const ModelLibrary = ({ isOpen, onClose }: ModelLibraryProps) => {
  const { models, pullStatus } = useModelStore();
  const { isOllamaConnected } = useUIStore();
  const { globalSettings } = useSettingsStore();
  const { fetchModels, deleteModel } = useModelActions();
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'featured' | 'installed'>('featured');
  const { t } = useTranslation(globalSettings.language);
  const { handlePull, translateOllamaStatus } = useModelPulling();

  const featuredModels = useMemo(() => 
    FEATURED_MODELS_LIST.map(m => ({ ...m, description: t(m.descriptionKey) })), 
  [t]);

  const handleDelete = useCallback(async (name: string) => {
    const confirmed = await dialog.ask(t('library.confirmDeleteNamed', { name }), {
      title: t('library.deleteModel'),
      kind: 'warning'
    });
    if (confirmed) await deleteModel(name);
  }, [deleteModel, t]);

  const filteredFeatured = useMemo(() => featuredModels.filter(m => 
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    m.description?.toLowerCase().includes(searchQuery.toLowerCase())
  ), [featuredModels, searchQuery]);

  const filteredInstalled = useMemo(() => models.filter(m => 
    m.name.toLowerCase().includes(searchQuery.toLowerCase())
  ), [models, searchQuery]);

  return (
    <ModalLayout isOpen={isOpen} onClose={onClose} maxWidth="max-w-4xl" className="h-[85vh]">
      <LibrarySearchHeader 
        language={globalSettings.language} activeTab={activeTab} setActiveTab={setActiveTab}
        searchQuery={searchQuery} setSearchQuery={setSearchQuery} isRefreshing={isRefreshing}
        onRefresh={() => fetchModels(true)} onClose={onClose} installedCount={models.length}
        onPullAny={handlePull}
      />

      {!isOllamaConnected && (
        <div className="ms-6 me-6 mbs-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-none flex items-center gap-3">
          <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
            {t('chat.connectionFailed')}
          </p>
        </div>
      )}

      <div className="flex-1 bg-white dark:bg-zinc-950/20 overflow-hidden">
        {activeTab === 'featured' ? (
          <VirtuosoGrid
            style={{ height: '100%' }} 
            data={filteredFeatured} 
            totalCount={filteredFeatured.length}
            listClassName="grid grid-cols-1 md:grid-cols-2 gap-4 p-6"
            itemContent={(idx, model) => (
              <ModelCard 
                key={model.name} name={model.name} description={model.description}
                size={model.size * 1024 * 1024 * 1024} isDownloaded={models.some(m => m.name.startsWith(model.name))}
                pullStatus={pullStatus[model.name] ? { ...pullStatus[model.name], status: translateOllamaStatus(pullStatus[model.name].status) } : undefined}
                onPull={handlePull} language={globalSettings.language}
              />
            )}
          />
        ) : (
          <Virtuoso
            style={{ height: '100%' }} 
            data={filteredInstalled} 
            itemContent={(idx, model) => (
              <div className={cn(
                "ps-6 pe-6 pbe-4", 
                idx === 0 && "pbs-6",
                idx === filteredInstalled.length - 1 && "pbe-12"
              )}>
                <ModelCard 
                  name={model.name} 
                  size={model.size} 
                  details={model.details || undefined} 
                  isDownloaded={true}
                  onDelete={handleDelete} 
                  language={globalSettings.language} 
                  variant="installed"
                />
              </div>
            )}
          />
        )}
      </div>

      <div className="ps-6 pe-6 py-4 bg-zinc-50 dark:bg-zinc-900/80 border-bs border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">{t('logs.logStorageInfo')}</span>
        <button onClick={onClose} className="ps-6 pe-6 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-none text-sm font-bold active:scale-95 transition-all">
          {t('common.done')}
        </button>
      </div>
    </ModalLayout>
  );
};

export default ModelLibrary;