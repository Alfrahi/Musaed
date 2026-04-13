"use client";

import { useEffect, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useSettingsStore, useUIStore } from '@/store';
import { Sliders, Library, Bot } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useTranslation } from '@/lib/i18n';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { cn } from '@/lib/utils';
import { checkIsTauri } from '@/lib/ipc';

import { Sidebar } from '@/features/sidebar';
import { ChatWindow, InputArea, useChatInitialization, useTauriEvents } from '@/features/chat';
import TaskStatus from './TaskStatus';

const SettingsModal = dynamic(() => import('@/features/settings').then(m => m.SettingsModal), { ssr: false });
const ModelLibrary = dynamic(() => import('@/features/library').then(m => m.ModelLibrary), { ssr: false });

export default function HomeClient() {
  const { globalSettings } = useSettingsStore();
  const { isHydrated, isOllamaConnected, isLibraryOpen, isSettingsOpen, setLibraryOpen, setSettingsOpen } = useUIStore();
  const { initializeApp } = useChatInitialization();
  const [mounted, setMounted] = useState(false);
  const { t, isRtl } = useTranslation(globalSettings.language);

  useTauriEvents();
  useGlobalShortcuts();

  useEffect(() => {
    setMounted(true);
    if (isHydrated) initializeApp();
  }, [isHydrated, initializeApp]);

  const isMac = useMemo(() => typeof window !== 'undefined' && navigator.userAgent.toUpperCase().includes('MAC'), []);
  const isTauri = checkIsTauri();

  if (!mounted) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Bot size={32} className="text-primary animate-pulse" />
      </div>
    );
  }

  return (
    <main className="flex h-screen bg-background overflow-hidden selection:bg-primary/20">
      <Sidebar />
      <div className="flex-1 flex flex-col relative">
        <header 
          data-tauri-drag-region={isTauri ? "true" : undefined}
          className={cn(
            "h-14 border-be border-zinc-200 dark:border-zinc-800 flex items-center ps-6 pe-6 justify-between shrink-0 bg-background/80 backdrop-blur-xl z-20 sticky inset-bs-0 select-none",
            isTauri && isMac && (isRtl ? "pe-20" : "ps-20")
          )}
        >
          <div className="flex items-center gap-3 pointer-events-none">
            <h1 className="font-black text-lg tracking-tighter text-foreground">{t('common.appName')}</h1>
            <div className="h-4 w-[1px] bg-zinc-200 dark:bg-zinc-800" />
            <div className="flex items-center gap-2">
              <div className={cn("w-2 h-2 rounded-full", isOllamaConnected ? "bg-green-500" : "bg-red-500")} />
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('chat.localNode')}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <TaskStatus />
            <div className="flex items-center gap-1.5">
              <button onClick={() => setLibraryOpen(true)} className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all text-zinc-500 hover:text-foreground">
                <Library size={18} />
                <span className="text-xs font-bold uppercase tracking-widest hidden sm:inline">{t('library.title')}</span>
              </button>
              <button onClick={() => setSettingsOpen(true)} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all text-zinc-500 hover:text-foreground">
                <Sliders size={18} />
              </button>
            </div>
          </div>
        </header>
        
        <div className="flex-1 relative overflow-hidden flex flex-col">
          <ChatWindow />
          <div className="bg-gradient-to-t from-background via-background/90 to-transparent pt-12 pb-4 px-4 z-10">
            {isHydrated ? <InputArea /> : <div className="animate-pulse bg-zinc-100 dark:bg-zinc-800 h-20 w-full max-w-4xl mx-auto rounded-[2rem]" />}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isSettingsOpen && <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />}
        {isLibraryOpen && <ModelLibrary isOpen={isLibraryOpen} onClose={() => setLibraryOpen(false)} />}
      </AnimatePresence>
    </main>
  );
}