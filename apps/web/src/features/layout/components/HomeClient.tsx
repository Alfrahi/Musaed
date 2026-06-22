'use client';

import { useEffect, useState, useMemo } from 'react';
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
} from '@/store/hooks';
import { useGlobalSettings } from '@/features/settings/store/settings-store';
import { registerHydrationCoordination } from '@/store/coordination';
import { Sliders, Library } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useTranslation } from '@/lib/i18n';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { cn } from '@/lib/utils';
import { checkIsTauri } from '@/lib/ipc';

import {
  useChatInitialization,
  useTauriEvents,
  useConversationMessages,
} from '@/features/conversation';
import TaskStatus from '@/components/ui/TaskStatus';
import OllamaConnectionStatus from '@/components/ui/OllamaConnectionStatus';

const Sidebar = dynamic(() => import('@/features/sidebar').then((m) => m.Sidebar), {
  ssr: false,
  loading: () => (
    <div className="border-sidebar-border w-72 animate-pulse border-e bg-zinc-50 dark:bg-zinc-900/50" />
  ),
});

const ChatWindow = dynamic(() => import('@/features/conversation').then((m) => m.ChatWindow), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center bg-zinc-50/30 dark:bg-zinc-950">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  ),
});

const InputArea = dynamic(() => import('@/features/conversation').then((m) => m.InputArea), {
  ssr: false,
  loading: () => (
    <div className="border-sidebar-border bg-background animate-pulse border-t p-4">
      <div className="h-12 rounded-none bg-zinc-100 dark:bg-zinc-800" />
    </div>
  ),
});

const SettingsModal = dynamic(() => import('@/features/settings').then((m) => m.SettingsModal), {
  ssr: false,
});
const ModelLibrary = dynamic(() => import('@/features/library').then((m) => m.ModelLibrary), {
  ssr: false,
});
const InfoModal = dynamic(() => import('@/features/info').then((m) => m.InfoModal), { ssr: false });

/** App header bar with title, connection status, and toolbar buttons. */
const AppHeader = ({
  isTauri,
  isMac,
  isRtl,
  onLibraryOpen,
  onSettingsOpen,
  appName,
}: {
  isTauri: boolean;
  isMac: boolean;
  isRtl: boolean;
  onLibraryOpen: () => void;
  onSettingsOpen: () => void;
  appName: string;
}) => (
  <header
    data-tauri-drag-region={isTauri ? 'true' : undefined}
    className={cn(
      'border-sidebar-border bg-background/50 z-20 flex h-[73px] shrink-0 items-center justify-between border-b px-4 backdrop-blur-md select-none',
      isTauri && isMac && (isRtl ? 'pe-20' : 'ps-20')
    )}
  >
    <div className="pointer-events-none flex items-center gap-4">
      <Image
        src="/favicon.ico"
        loading="eager"
        alt={appName}
        width={40}
        height={40}
        unoptimized
        className="h-10 w-10 object-contain"
      />
      <div className="bg-sidebar-border h-3 w-[1px]" />
      <div className="pointer-events-auto">
        <OllamaConnectionStatus />
      </div>
    </div>
    <div className="flex items-center gap-2">
      <TaskStatus />
      <button
        onClick={onLibraryOpen}
        className="hover:border-sidebar-border flex h-10 w-10 items-center justify-center rounded-none border border-transparent text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title={appName}
      >
        <Library size={18} />
      </button>
      <button
        onClick={onSettingsOpen}
        className="hover:border-sidebar-border flex h-10 w-10 items-center justify-center rounded-none border border-transparent text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title={appName}
      >
        <Sliders size={18} />
      </button>
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
  const { initializeApp } = useChatInitialization();
  const [mounted, setMounted] = useState(false);
  const { t, isRtl } = useTranslation(globalSettings.language);

  useTauriEvents();
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

  const isMac = useMemo(
    () => typeof window !== 'undefined' && navigator.userAgent.toUpperCase().includes('MAC'),
    []
  );
  const isTauri = checkIsTauri();

  if (!mounted) return null;

  return (
    <main className="bg-background flex h-screen overflow-hidden font-sans">
      <Sidebar />
      <div className="border-is border-sidebar-border flex min-w-0 flex-1 flex-col">
        <AppHeader
          isTauri={isTauri}
          isMac={isMac}
          isRtl={isRtl}
          onLibraryOpen={() => setLibraryOpen(true)}
          onSettingsOpen={() => setSettingsOpen(true)}
          appName={t('common.appName')}
        />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ChatWindow />
          <InputArea />
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
      </AnimatePresence>
    </main>
  );
};

export default HomeClient;
