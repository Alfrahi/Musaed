'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useIsHydrated, useActiveModal, useOpenModal, useCloseModal } from '@/store/hooks';
import { useGlobalSettings } from '@/store/settings-store';
import { registerHydrationCoordination } from '@/store/coordination';
import { Sliders, Library } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useTranslation } from '@/lib/i18n';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { cn } from '@/lib/utils';
import { isMac as detectIsMac, isWindows as detectIsWindows } from '@/lib/platform';
import { checkIsTauri } from '@/lib/ipc';
import { Button } from '@/components/ui/button';

import { useTauriEvents, useConversationMessages } from '@/features/conversation';
import { useLibraryTauriEvents } from '@/features/library';
import { useAppInitialization } from '@/hooks';
import { useOllamaConnection } from '@/hooks/useOllamaConnection';
import TaskStatus from '@/components/ui/TaskStatus';
import OllamaConnectionStatus from '@/components/ui/OllamaConnectionStatus';

const Sidebar = dynamic(() => import('@/features/sidebar').then((m) => m.Sidebar), {
  ssr: false,
  loading: () => (
    <div className="border-sidebar-border w-72 animate-pulse border-e bg-zinc-50 dark:bg-zinc-900/50" />
  ),
});

const ChatWindowDynamic = dynamic(() => import('@/features/conversation/components/ChatWindow'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center bg-zinc-50/30 dark:bg-zinc-950">
      <div className="border-bs-transparent h-8 w-8 animate-spin rounded-full border-4 border-blue-600" />
    </div>
  ),
});

const InputAreaDynamic = dynamic(() => import('@/features/conversation/components/InputArea'), {
  ssr: false,
  loading: () => (
    <div className="border-sidebar-border bg-background border-bs animate-pulse p-4">
      <div className="h-12 rounded-md bg-zinc-100 dark:bg-zinc-800" />
    </div>
  ),
});

const SettingsModal = dynamic(() => import('@/features/settings/components/SettingsModal'), {
  ssr: false,
});
const ModelLibrary = dynamic(() => import('@/features/library').then((m) => m.ModelLibrary), {
  ssr: false,
});
const InfoModal = dynamic(() => import('@/features/info').then((m) => m.InfoModal), { ssr: false });
const SearchModalDynamic = dynamic(() => import('@/features/search').then((m) => m.SearchModal), {
  ssr: false,
});
const CommandPalette = dynamic(() => import('./CommandPalette'), { ssr: false });
const ShortcutCheatsheet = dynamic(() => import('@/components/ui/ShortcutCheatsheet'), {
  ssr: false,
});

/** App header bar with title, connection status, and toolbar buttons. */
export const AppHeader = ({
  isTauri,
  isMac,
  isWindows,
  isRtl,
  onLibraryOpen,
  onSettingsOpen,
  appName,
  t,
}: {
  isTauri: boolean;
  isMac: boolean;
  isWindows: boolean;
  isRtl: boolean;
  onLibraryOpen: () => void;
  onSettingsOpen: () => void;
  appName: string;
  t: ReturnType<typeof useTranslation>['t'];
}) => (
  <header
    data-tauri-drag-region={isTauri ? 'true' : undefined}
    className={cn(
      'border-sidebar-border bg-background/50 border-be z-20 flex h-12 shrink-0 items-center justify-between px-3 backdrop-blur-md select-none',
      isTauri && isMac && (isRtl ? 'pe-20' : 'ps-20'),
      isTauri && isWindows && (isRtl ? 'ps-28' : 'pe-28')
    )}
  >
    <div className="flex items-center gap-3">
      <div className="pointer-events-none flex items-center gap-3">
        <Image
          src="/favicon.ico"
          loading="eager"
          alt={appName}
          width={28}
          height={28}
          unoptimized
          className="h-7 w-7 object-contain"
        />
        <div className="bg-sidebar-border h-3 w-[1px]" />
        <div className="pointer-events-auto">
          <OllamaConnectionStatus />
        </div>
      </div>
    </div>
    <div className="flex items-center gap-2">
      <TaskStatus />
      <Button
        variant="ghost"
        size="icon"
        onClick={onLibraryOpen}
        className="hover:border-sidebar-border h-8 w-8 rounded-md border border-transparent text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title={t('common.library')}
        aria-label={t('common.library')}
      >
        <Library size={16} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onSettingsOpen}
        className="hover:border-sidebar-border h-8 w-8 rounded-md border border-transparent text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title={t('settings.title')}
        aria-label={t('settings.title')}
      >
        <Sliders size={16} />
      </Button>
    </div>
  </header>
);

const HomeClient = () => {
  const globalSettings = useGlobalSettings();
  const isHydrated = useIsHydrated();
  const activeModal = useActiveModal();
  const openModal = useOpenModal();
  const closeModal = useCloseModal();
  const { initializeApp } = useAppInitialization();
  const { reconnect } = useOllamaConnection();
  const [mounted, setMounted] = useState(false);
  const { t, isRtl } = useTranslation(globalSettings.language);

  useTauriEvents();
  useLibraryTauriEvents();
  useGlobalShortcuts();
  useConversationMessages();

  useEffect(() => {
    const unsubscribe = registerHydrationCoordination();
    return unsubscribe;
  }, []);

  useEffect(() => {
    setMounted(true);
    if (isHydrated) initializeApp();
  }, [isHydrated, initializeApp]);

  const isMac = detectIsMac();
  const isWindows = detectIsWindows();
  const isTauri = checkIsTauri();

  if (!mounted) return null;

  return (
    <main id="main" className="bg-background flex h-screen overflow-hidden font-sans">
      <Sidebar />
      <div className="border-is border-sidebar-border flex min-w-0 flex-1 flex-col">
        <AppHeader
          isTauri={isTauri}
          isMac={isMac}
          isWindows={isWindows}
          isRtl={isRtl}
          onLibraryOpen={() => openModal('library')}
          onSettingsOpen={() => openModal('settings')}
          appName={t('common.appName')}
          t={t}
        />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ChatWindowDynamic
            onInstallModel={() => openModal('library')}
            onStartOllama={() => void reconnect()}
          />
          <InputAreaDynamic />
        </div>
      </div>
      <AnimatePresence>
        {activeModal === 'settings' && <SettingsModal isOpen={true} onClose={closeModal} />}
        {activeModal === 'library' && <ModelLibrary isOpen={true} onClose={closeModal} />}
        {activeModal === 'info' && <InfoModal isOpen={true} onClose={closeModal} />}
        {activeModal === 'search' && <SearchModalDynamic isOpen={true} onClose={closeModal} />}
        {activeModal === 'cheatsheet' && <ShortcutCheatsheet isOpen={true} onClose={closeModal} />}
        {activeModal === 'commandPalette' && <CommandPalette isOpen={true} onClose={closeModal} />}
      </AnimatePresence>
    </main>
  );
};

export default HomeClient;
