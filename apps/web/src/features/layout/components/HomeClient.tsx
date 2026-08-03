'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import {
  useIsHydrated,
  useIsLibraryOpen,
  useIsSettingsOpen,
  useIsInfoOpen,
  useSetLibraryOpen,
  useSetSettingsOpen,
  useSetInfoOpen,
  useSetCheatsheetOpen,
  useSetCommandPaletteOpen,
} from '@/store/hooks';
import { useUIStore } from '@/store/ui-store';
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
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  ),
});

const InputAreaDynamic = dynamic(() => import('@/features/conversation/components/InputArea'), {
  ssr: false,
  loading: () => (
    <div className="border-sidebar-border bg-background animate-pulse border-t p-4">
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
      'border-sidebar-border bg-background/50 z-20 flex h-12 shrink-0 items-center justify-between border-b px-3 backdrop-blur-md select-none',
      isTauri && isMac && (isRtl ? 'pe-20' : 'ps-20'),
      isTauri && isWindows && (isRtl ? 'ps-28' : 'pe-28')
    )}
  >
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
  const isLibraryOpen = useIsLibraryOpen();
  const isSettingsOpen = useIsSettingsOpen();
  const isInfoOpen = useIsInfoOpen();
  const setLibraryOpen = useSetLibraryOpen();
  const setSettingsOpen = useSetSettingsOpen();
  const setInfoOpen = useSetInfoOpen();
  const setCheatsheetOpen = useSetCheatsheetOpen();
  const setCommandPaletteOpen = useSetCommandPaletteOpen();
  const isCheatsheetOpen = useUIStore((s) => s.isCheatsheetOpen);
  const isCommandPaletteOpen = useUIStore((s) => s.isCommandPaletteOpen);
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
          onLibraryOpen={() => setLibraryOpen(true)}
          onSettingsOpen={() => setSettingsOpen(true)}
          appName={t('common.appName')}
          t={t}
        />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ChatWindowDynamic
            onInstallModel={() => setLibraryOpen(true)}
            onStartOllama={() => void reconnect()}
          />
          <InputAreaDynamic />
        </div>
      </div>
      <AnimatePresence>
        {isSettingsOpen && (
          <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />
        )}
        {isLibraryOpen && (
          <ModelLibrary isOpen={isLibraryOpen} onClose={() => setLibraryOpen(false)} />
        )}
        {isInfoOpen && <InfoModal isOpen={isInfoOpen} onClose={() => setInfoOpen(false)} />}
        {isCheatsheetOpen && (
          <ShortcutCheatsheet isOpen={isCheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
        )}
        {isCommandPaletteOpen && (
          <CommandPalette
            isOpen={isCommandPaletteOpen}
            onClose={() => setCommandPaletteOpen(false)}
          />
        )}
      </AnimatePresence>
    </main>
  );
};

export default HomeClient;
