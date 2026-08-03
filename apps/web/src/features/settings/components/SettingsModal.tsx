'use client';

import { useState, useMemo, useId, useEffect, useRef } from 'react';
import { X, Settings2, RotateCcw, Cpu, HardDrive, Terminal, Layout, Search } from 'lucide-react';
import { useGlobalSettings } from '@/store/settings-store';
import { useSettingsActions } from '@/features/settings/hooks/useSettingsActions';
import LanguageSettings from './LanguageSettings';
import ThemeSettings from './ThemeSettings';
import OllamaSettings from './OllamaSettings';
import ModelParamsSettings from './ModelParamsSettings';
import DiagnosticsSettings from './DiagnosticsSettings';
import InputSettings from './InputSettings';
import StorageSettings from './StorageSettings';
import MarkdownSettings from './MarkdownSettings';
import { useTranslation } from '@/lib/i18n';
import { dialogApi } from '@/lib/ipc';
import { ModalLayout, ScrollShadow, Input } from '@/components/ui';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'appearance' | 'ai' | 'storage' | 'advanced';

const renderGeneralTab = () => (
  <div className="animate-in fade-in slide-in-from-bottom-2 duration-normal space-y-8">
    <LanguageSettings />
    <InputSettings />
  </div>
);

const renderAppearanceTab = () => (
  <div className="animate-in fade-in slide-in-from-bottom-2 duration-normal space-y-8">
    <ThemeSettings />
    <MarkdownSettings />
  </div>
);

const renderAITab = () => (
  <div className="animate-in fade-in slide-in-from-bottom-2 duration-normal space-y-8">
    <OllamaSettings />
    <ModelParamsSettings />
  </div>
);

const renderStorageTab = () => (
  <div className="animate-in fade-in slide-in-from-bottom-2 duration-normal space-y-8">
    <StorageSettings />
  </div>
);

interface RenderAdvancedTabProps {
  t: (key: string) => string;
  handleReset: () => Promise<void>;
}

const RenderAdvancedTab = ({ t, handleReset }: RenderAdvancedTabProps) => (
  <div className="animate-in fade-in slide-in-from-bottom-2 duration-normal space-y-8">
    <DiagnosticsSettings />
    <div className="pb-4">
      <Button
        variant="danger"
        size="md"
        onClick={handleReset}
        className="flex w-full cursor-pointer items-center justify-center gap-2"
      >
        <RotateCcw size={14} aria-hidden="true" /> {t('settings.resetPreferences')}
      </Button>
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
  titleId: string;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

const RenderModalHeader = ({
  t,
  onClose,
  titleId,
  searchQuery,
  onSearchChange,
  onSearchKeyDown,
  searchInputRef,
}: RenderModalHeaderProps) => (
  <div className="flex shrink-0 flex-col gap-3 border-b border-zinc-100 p-4 dark:border-zinc-800">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 font-semibold">
        <Settings2 size={18} className="text-blue-500" aria-hidden="true" />
        <span id={titleId}>{t('settings.title')}</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="cursor-pointer text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label={t('a11y.closeModal')}
      >
        <X size={20} />
      </Button>
    </div>
    <div className="relative w-full">
      <Search
        size={16}
        className="pointer-events-none absolute inset-y-0 start-3 my-auto text-zinc-400"
        aria-hidden="true"
      />
      <Input
        ref={searchInputRef}
        type="search"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={onSearchKeyDown}
        placeholder={t('settings.searchPlaceholder')}
        aria-label={t('settings.searchPlaceholder')}
        className="text-body duration-normal w-full ps-9 text-zinc-900 dark:text-zinc-100"
      />
    </div>
  </div>
);

interface RenderTabNavigationProps {
  tabs: { id: SettingsTab; label: string; icon: React.ComponentType<{ size: number }> }[];
  activeTab: SettingsTab;
  setActiveTab: (tab: SettingsTab) => void;
}

const RenderTabNavigation = ({ tabs, activeTab, setActiveTab }: RenderTabNavigationProps) => (
  <aside className="border-ie w-48 shrink-0 overflow-y-auto border-zinc-100 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/20">
    <nav className="space-y-1 p-2">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'caption-md duration-normal flex w-full cursor-pointer items-center gap-3 rounded-md border-s-2 px-3 py-2.5 font-bold tracking-widest uppercase transition-all',
              isActive
                ? 'shadow-native border-blue-500 bg-white text-blue-600 dark:bg-zinc-800 dark:text-blue-400'
                : 'border-transparent text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-100'
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
  <div className="flex shrink-0 justify-end border-t border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
    <Button variant="secondary" size="md" onClick={onClose} className="tracking-normal">
      {t('common.done')}
    </Button>
  </div>
);

const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const globalSettings = useGlobalSettings();
  const { resetGlobalSettings } = useSettingsActions();
  const { t } = useTranslation(globalSettings.language);

  // Reset search when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Listen for Cmd+K while settings is open to focus the search input.
  // Uses stopImmediatePropagation to prevent the global Cmd+K handler
  // (useGlobalShortcuts) from also opening the command palette.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        e.stopImmediatePropagation();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleReset = async () => {
    const confirmed = await dialogApi.ask(
      t('settings.resetPreferences'),
      t('settings.confirmReset'),
      'warning'
    );

    if (confirmed) resetGlobalSettings();
  };

  const tabs = useMemo(
    () => [
      { id: 'general' as const, label: t('settings.tabs.general'), icon: Settings2 },
      { id: 'appearance' as const, label: t('settings.tabs.appearance'), icon: Layout },
      { id: 'ai' as const, label: t('settings.tabs.ai'), icon: Cpu },
      { id: 'storage' as const, label: t('settings.tabs.storage'), icon: HardDrive },
      { id: 'advanced' as const, label: t('settings.tabs.advanced'), icon: Terminal },
    ],
    [t]
  );

  const filteredTabs = searchQuery
    ? tabs.filter((tab) => tab.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : tabs;

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && filteredTabs.length > 0) {
      e.preventDefault();
      setActiveTab(filteredTabs[0].id);
      setSearchQuery('');
    } else if (e.key === 'Escape') {
      setSearchQuery('');
      searchInputRef.current?.blur();
    }
  };

  return (
    <ModalLayout
      isOpen={isOpen}
      onClose={onClose}
      titleId={titleId}
      maxWidth="max-w-3xl"
      className="h-[min(85vh,640px)]"
    >
      <RenderModalHeader
        t={t}
        onClose={onClose}
        titleId={titleId}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchKeyDown={handleSearchKeyDown}
        searchInputRef={searchInputRef}
      />

      <div className="flex flex-1 overflow-hidden">
        <RenderTabNavigation
          tabs={filteredTabs}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
        />

        <ScrollShadow
          className="flex-1 overflow-y-auto bg-white dark:bg-zinc-950/20"
          contentClassName="p-8"
        >
          <RenderContent activeTab={activeTab} t={t} handleReset={handleReset} />
        </ScrollShadow>
      </div>

      <RenderModalFooter t={t} onClose={onClose} />
    </ModalLayout>
  );
};

export default SettingsModal;
