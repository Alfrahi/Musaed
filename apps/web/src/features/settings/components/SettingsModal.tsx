'use client';

import { useState, useMemo, useId, useEffect, useRef } from 'react';
import { X, Settings2, RotateCcw, Cpu, HardDrive, Terminal, Layout, Search } from 'lucide-react';
import { useGlobalSettings } from '@/store/settings-store';
import { useSettingsActions } from '@/features/settings/hooks/useSettingsActions';
import LanguageSettings from './LanguageSettings';
import ThemeSettings from './ThemeSettings';
import OllamaSettings from './OllamaSettings';
import DiagnosticsSettings from './DiagnosticsSettings';
import InputSettings from './InputSettings';
import StorageSettings from './StorageSettings';
import MarkdownSettings from './MarkdownSettings';
import WindowSettings from './WindowSettings';
import SettingsCard from './SettingsCard';
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
  <>
    <SettingsCard>
      <LanguageSettings />
    </SettingsCard>
    <SettingsCard>
      <InputSettings />
    </SettingsCard>
    <SettingsCard>
      <WindowSettings />
    </SettingsCard>
  </>
);

const renderAppearanceTab = () => (
  <>
    <SettingsCard>
      <ThemeSettings />
    </SettingsCard>
    <SettingsCard>
      <MarkdownSettings />
    </SettingsCard>
  </>
);

const renderAITab = () => (
  <>
    <SettingsCard>
      <OllamaSettings />
    </SettingsCard>
  </>
);

const renderStorageTab = () => (
  <>
    <SettingsCard>
      <StorageSettings />
    </SettingsCard>
  </>
);

interface RenderAdvancedTabProps {
  t: (key: string) => string;
  handleReset: () => Promise<void>;
}

const RenderAdvancedTab = ({ t, handleReset }: RenderAdvancedTabProps) => (
  <>
    <SettingsCard>
      <DiagnosticsSettings />
    </SettingsCard>
    <div className="pbe-4">
      <Button
        variant="danger"
        size="md"
        onClick={handleReset}
        className="flex w-full cursor-pointer items-center justify-center gap-2"
      >
        <RotateCcw size={14} aria-hidden="true" /> {t('settings.resetPreferences')}
      </Button>
    </div>
  </>
);

interface RenderContentProps {
  activeTab: SettingsTab;
  t: (key: string) => string;
  handleReset: () => Promise<void>;
  panelId: string;
  tabButtonId: string;
}

const RenderContent = ({ activeTab, t, handleReset, panelId, tabButtonId }: RenderContentProps) => (
  <div
    id={panelId}
    role="tabpanel"
    aria-labelledby={tabButtonId}
    tabIndex={0}
    className="animate-in fade-in slide-in-from-bottom-2 duration-normal space-y-6"
  >
    {(() => {
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
    })()}
  </div>
);

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
  <div className="border-be flex shrink-0 flex-col gap-3 border-zinc-100 px-4 py-3 dark:border-zinc-800">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-zinc-100 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
          <Settings2 size={18} className="text-blue-500" aria-hidden="true" />
        </div>
        <span id={titleId} className="font-semibold">
          {t('settings.title')}
        </span>
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
  idPrefix: string;
  isRtl: boolean;
}

const RenderTabNavigation = ({
  tabs,
  activeTab,
  setActiveTab,
  idPrefix,
  isRtl,
}: RenderTabNavigationProps) => {
  const tablistRef = useRef<HTMLDivElement>(null);

  const getTabButtons = () =>
    tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? null;

  const focusTabAt = (index: number) => {
    const buttons = getTabButtons();
    if (!buttons || buttons.length === 0) return;
    const wrapped = (index + buttons.length) % buttons.length;
    buttons[wrapped].focus();
  };

  // Resolve the anchor index for arrow navigation from the DOM rather than
  // the `activeTab` prop: under the WAI-ARIA "follow-focus" pattern the
  // focused tab *is* the active tab, and reading from the DOM sidesteps
  // stale-closure and React-flush ordering between onFocus→setActiveTab and
  // the subsequent keydown. Falls back to the aria-selected tab when nothing
  // is focused (e.g. the very first Home/End press).
  const currentTabIndex = () => {
    const buttons = getTabButtons();
    if (!buttons || buttons.length === 0) return 0;
    const focusedEl = document.activeElement as HTMLButtonElement | null;
    const focusedIndex = focusedEl ? Array.from(buttons).indexOf(focusedEl) : -1;
    if (focusedIndex >= 0) return focusedIndex;
    for (let i = 0; i < buttons.length; i++) {
      if (buttons[i].getAttribute('aria-selected') === 'true') return i;
    }
    return 0;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (tabs.length === 0) return;
    const currentIndex = currentTabIndex();

    let handled = false;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown': {
        // In RTL, ArrowRight moves backward (towards the visual start).
        const step = isRtl && e.key === 'ArrowRight' ? -1 : 1;
        focusTabAt(currentIndex + step);
        handled = true;
        break;
      }
      case 'ArrowLeft':
      case 'ArrowUp': {
        const step = isRtl && e.key === 'ArrowLeft' ? 1 : -1;
        focusTabAt(currentIndex + step);
        handled = true;
        break;
      }
      case 'Home':
        focusTabAt(0);
        handled = true;
        break;
      case 'End':
        focusTabAt(tabs.length - 1);
        handled = true;
        break;
      default:
        break;
    }
    if (handled) e.preventDefault();
  };

  return (
    <aside className="border-ie w-48 shrink-0 overflow-y-auto border-zinc-100 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/20">
      <div
        ref={tablistRef}
        role="tablist"
        aria-orientation="vertical"
        onKeyDown={handleKeyDown}
        className="space-y-1 p-2"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const tabButtonId = `${idPrefix}-tab-${tab.id}`;
          const tabPanelId = `${idPrefix}-panel-${tab.id}`;
          return (
            <button
              key={tab.id}
              id={tabButtonId}
              role="tab"
              aria-selected={isActive}
              aria-controls={tabPanelId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onFocus={() => setActiveTab(tab.id)}
              className={cn(
                'caption-md focus-ring duration-fast flex w-full cursor-pointer items-center gap-3 rounded-md border-s-2 px-3 py-2.5 font-bold tracking-widest uppercase transition-all',
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
      </div>
    </aside>
  );
};

interface RenderModalFooterProps {
  t: (key: string) => string;
  onClose: () => void;
}

const RenderModalFooter = ({ t, onClose }: RenderModalFooterProps) => (
  <div className="border-bs flex shrink-0 justify-end gap-2 border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
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
  const tabIdPrefix = useId();
  const globalSettings = useGlobalSettings();
  const { resetGlobalSettings } = useSettingsActions();
  const { t, isRtl } = useTranslation(globalSettings.language);

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
      maxWidth="max-w-3xl max-[640px]:max-w-full"
      className="h-[min(85vh,640px)] max-[640px]:h-full max-[640px]:rounded-none"
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
          idPrefix={tabIdPrefix}
          isRtl={isRtl}
        />

        <ScrollShadow
          className="flex-1 overflow-y-auto bg-white dark:bg-zinc-950/20"
          contentClassName="p-8"
        >
          <RenderContent
            activeTab={activeTab}
            t={t}
            handleReset={handleReset}
            panelId={`${tabIdPrefix}-panel-${activeTab}`}
            tabButtonId={`${tabIdPrefix}-tab-${activeTab}`}
          />
        </ScrollShadow>
      </div>

      <RenderModalFooter t={t} onClose={onClose} />
    </ModalLayout>
  );
};

export default SettingsModal;
