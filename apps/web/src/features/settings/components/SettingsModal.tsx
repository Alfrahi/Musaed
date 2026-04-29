"use client";

import { useState, useMemo } from 'react';
import {
  X,
  Settings2,
  RotateCcw,
  Cpu,
  HardDrive,
  Terminal,
  Layout
} from 'lucide-react';
import { useGlobalSettings } from '../../../store/hooks';
import { useSettingsActions } from '../hooks/useSettingsActions';
import LanguageSettings from './LanguageSettings';
import ThemeSettings from './ThemeSettings';
import OllamaSettings from './OllamaSettings';
import ModelParamsSettings from './ModelParamsSettings';
import DiagnosticsSettings from './DiagnosticsSettings';
import InputSettings from './InputSettings';
import StorageSettings from './StorageSettings';
import MarkdownSettings from './MarkdownSettings';
import { TranslationKey, useTranslation } from '../../../lib/i18n';
import { dialog } from '../../../lib/ipc';
import { ModalLayout } from '@/components/ui';
import { cn } from '../../../lib/utils';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'appearance' | 'ai' | 'storage' | 'advanced';

const renderGeneralTab = () => (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-200">
    <LanguageSettings />
    <InputSettings />
  </div>
);

const renderAppearanceTab = () => (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-200">
    <ThemeSettings />
    <MarkdownSettings />
  </div>
);

const renderAITab = () => (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-200">
    <OllamaSettings />
    <ModelParamsSettings />
  </div>
);

const renderStorageTab = () => (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-200">
    <StorageSettings />
  </div>
);

interface RenderAdvancedTabProps {
  t: (key: string) => string;
  handleReset: () => Promise<void>;
}

const RenderAdvancedTab = ({ t, handleReset }: RenderAdvancedTabProps) => (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-200">
    <DiagnosticsSettings />
    <div className="pb-4">
      <button
        onClick={handleReset}
        className="w-full flex items-center justify-center gap-2 py-3 border border-zinc-200 dark:border-zinc-800 rounded-lg text-[10px] font-bold uppercase tracking-widest text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all focus-visible:ring-2 focus-visible:ring-blue-500 outline-none active:scale-95"
      >
        <RotateCcw size={14} aria-hidden="true" /> {t('settings.resetPreferences')}
      </button>
    </div>
  </div>
);

interface RenderContentProps {
  activeTab: SettingsTab;
  t: (key: string) => string;
  handleReset: () => Promise<void>;
}

const RenderContent = ({ activeTab, t, handleReset }: RenderContentProps) => {
  switch (activeTab) {
    case 'general':
      return renderGeneralTab();
    case 'appearance':
      return renderAppearanceTab();
    case 'ai':
      return renderAITab();
    case 'storage':
      return renderStorageTab();
    case 'advanced':
      return <RenderAdvancedTab t={t} handleReset={handleReset} />;
    default:
      return null;
  }
};

interface RenderModalHeaderProps {
  t: (key: string) => string;
  onClose: () => void;
}

const RenderModalHeader = ({ t, onClose }: RenderModalHeaderProps) => (
  <div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
    <div className="flex items-center gap-2 font-semibold">
      <Settings2 size={18} className="text-blue-500" aria-hidden="true" />
      <span>{t('settings.title')}</span>
    </div>
    <button
      onClick={onClose}
      className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all text-zinc-500"
      aria-label={t('a11y.closeModal')}
    >
      <X size={20} />
    </button>
  </div>
);

interface RenderTabNavigationProps {
  tabs: { id: SettingsTab; label: string; icon: React.ComponentType<{ size: number }> }[];
  activeTab: SettingsTab;
  setActiveTab: (tab: SettingsTab) => void;
}

const RenderTabNavigation = ({ tabs, activeTab, setActiveTab }: RenderTabNavigationProps) => (
  <aside className="w-48 border-ie border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20 shrink-0 overflow-y-auto">
    <nav className="p-2 space-y-1">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest transition-all rounded-lg border-s-2",
              isActive
                ? "bg-white dark:bg-zinc-800 border-blue-500 text-blue-600 dark:text-blue-400 shadow-sm"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
            )}
          >
            <Icon size={16} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  </aside>
);

interface RenderModalFooterProps {
  t: (key: string) => string;
  onClose: () => void;
}

const RenderModalFooter = ({ t, onClose }: RenderModalFooterProps) => (
  <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800 flex justify-end shrink-0">
    <button
      onClick={onClose}
      className="px-6 h-10 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg text-xs font-bold uppercase tracking-widest active:scale-95 transition-all shadow-sm hover:opacity-90"
    >
      {t('common.done')}
    </button>
  </div>
);

const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const globalSettings = useGlobalSettings();
  const { resetGlobalSettings } = useSettingsActions();
  const { t } = useTranslation(globalSettings.language);

  const handleReset = async () => {
    const confirmed = await dialog.ask(t('settings.confirmReset'), {
      title: t('settings.resetPreferences'),
      kind: 'warning'
    });

    if (confirmed) resetGlobalSettings();
  };

  const tabs = useMemo(() => [
    { id: 'general' as const, label: t('settings.tabs.general' as TranslationKey), icon: Settings2 },
    { id: 'appearance' as const, label: t('settings.tabs.appearance' as TranslationKey), icon: Layout },
    { id: 'ai' as const, label: t('settings.tabs.ai' as TranslationKey), icon: Cpu },
    { id: 'storage' as const, label: t('settings.tabs.storage' as TranslationKey), icon: HardDrive },
    { id: 'advanced' as const, label: t('settings.tabs.advanced' as TranslationKey), icon: Terminal },
  ], [t]);

  return (
    <ModalLayout isOpen={isOpen} onClose={onClose} maxWidth="max-w-3xl" className="h-[600px]">
      <RenderModalHeader t={t} onClose={onClose} />

      <div className="flex-1 flex overflow-hidden">
        <RenderTabNavigation tabs={tabs} activeTab={activeTab} setActiveTab={setActiveTab} />

        <main className="flex-1 overflow-y-auto p-8 bg-white dark:bg-zinc-950/20">
          <RenderContent activeTab={activeTab} t={t} handleReset={handleReset} />
        </main>
      </div>

      <RenderModalFooter t={t} onClose={onClose} />
    </ModalLayout>
  );
};

export default SettingsModal;
