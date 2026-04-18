"use client";

import { useEffect, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useSettingsStore, useUIStore } from '@/store';
import { Sliders, Library } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useTranslation } from '@/lib/i18n';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { cn } from '@/lib/utils';
import { checkIsTauri } from '@/lib/ipc';

import { Sidebar } from '@/features/sidebar';
import { ChatWindow, InputArea, useChatInitialization, useTauriEvents } from '@/features/chat';
import TaskStatus from './TaskStatus';
import OllamaConnectionStatus from './OllamaConnectionStatus';

const SettingsModal = dynamic(() => import('@/features/settings').then(m => m.SettingsModal), { ssr: false });
const ModelLibrary = dynamic(() => import('@/features/library').then(m => m.ModelLibrary), { ssr: false });

export default function HomeClient() {
  const { globalSettings } = useSettingsStore();
  const { isHydrated, isLibraryOpen, isSettingsOpen, setLibraryOpen, setSettingsOpen } = useUIStore();
  const { initializeApp } = useChatInitialization();
  const [mounted, setMounted] = useState(false);
  const { t, isRtl } = useTranslation(globalSettings.language);

  useTauriEvents();
  useGlobalShortcuts();

  useEffect(() => {
    setMounted(true);
    if (isHydrated) {
      initializeApp();
    }
  }, [isHydrated, initializeApp]);

  const isMac = useMemo(() => typeof window !== 'undefined' && navigator.userAgent.toUpperCase().includes('MAC'), []);
  const isTauri = checkIsTauri();

  if (!mounted) return null;

  return (
    <main className="flex h-screen bg-background overflow-hidden font-sans">
      <Sidebar />
      
      <div className="flex-1 flex flex-col min-w-0 border-is border-sidebar-border">
        <header
          data-tauri-drag-region={isTauri ? "true" : undefined}
          className={cn(
            "h-[73px] border-b border-sidebar-border flex items-center px-4 justify-between shrink-0 bg-background/50 backdrop-blur-md z-20 select-none",
            isTauri && isMac && (isRtl ? "pe-20" : "ps-20")
          )}
        >
          <div className="flex items-center gap-4 pointer-events-none">
            <img 
              src="/favicon.ico" 
              alt={t('common.appName')} 
              className="w-10 h-10 object-contain" 
            />
            <div className="h-3 w-[1px] bg-sidebar-border" />
            <div className="pointer-events-auto">
              <OllamaConnectionStatus />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <TaskStatus />
            <button
              onClick={() => setLibraryOpen(true)}
              className="w-10 h-10 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 rounded-none border border-transparent hover:border-sidebar-border"
              title={t('library.title')}
            >
              <Library size={18} />
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-10 h-10 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 rounded-none border border-transparent hover:border-sidebar-border"
              title={t('settings.title')}
            >
              <Sliders size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 relative flex flex-col min-h-0">
          <ChatWindow />
          <InputArea />
        </div>
      </div>

      <AnimatePresence>
        {isSettingsOpen && <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />}
        {isLibraryOpen && <ModelLibrary isOpen={isLibraryOpen} onClose={() => setLibraryOpen(false)} />}
      </AnimatePresence>
    </main>
  );
}