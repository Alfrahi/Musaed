"use client";

import { useState, useMemo, useCallback } from 'react';
import { Plus, RefreshCw, AlertCircle } from 'lucide-react';
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso';
import { useModelStore, useSettingsStore, useUIStore } from '../../../store';
import { useTranslation } from '../../../lib/i18n';
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
  { name: 'deepseek-r1:1.5b', descriptionKey: 'models.deepseekR1_15b', size: 1.1 },
  { name: 'deepseek-r1:7b', descriptionKey: 'models.deepseekR1_7b', size: 4.7 },
  { name: 'llama3.2', descriptionKey: 'models.llama32', size: 2.0 },
  { name: 'llama3.1', descriptionKey: 'models.llama31', size: 4.7 },
  { name: 'mistral', descriptionKey: 'models.mistral', size: 4.1 },
  { name: 'phi3', descriptionKey: 'models.phi3', size: 2.3 },
  { name: 'gemma2', descriptionKey: 'models.gemma2', size: 5.4 },
  { name: 'llava', descriptionKey: 'models.llava', size: 4.5 },
  { name: 'codellama', descriptionKey: 'models.codellama', size: 3.8 },
  { name: 'qwen2.5', descriptionKey: 'models.qwen25', size: 4.4 },
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
    FEATURED_MODELS_LIST.map(m => ({ ...m, description: t(m.descriptionKey as any) })), 
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
      />

      <div className="flex-1 bg-white dark:bg-zinc-950/20 overflow-hidden">
        {activeTab === 'featured' ? (
          <VirtuosoGrid
            style={{ height: '100%' }} data={filteredFeatured} totalCount={filteredFeatured.length}
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
            style={{ height: '100%' }} data={filteredInstalled} className="p-6"
            itemContent={(idx, model) => (
              <div className="pb-3">
                <ModelCard 
                  name={model.name} size={model.size} isDownloaded={true}
                  onDelete={handleDelete} language={globalSettings.language} variant="installed"
                />
              </div>
            )}
          />
        )}
      </div>

      <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900/80 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">{t('logs.logStorageInfo')}</span>
        <button onClick={onClose} className="px-6 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl text-sm font-bold active:scale-95 transition-all">
          {t('common.done')}
        </button>
      </div>
    </ModalLayout>
  );
};

export default ModelLibrary;