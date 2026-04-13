"use client";

import { useEffect, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useSettingsStore, useUIStore } from '@/store';
import { Sliders, Library, Bot, AlertCircle, Loader2, WifiOff, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/lib/i18n';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { cn } from '@/lib/utils';
import { checkIsTauri } from '@/lib/ipc';

import { Sidebar } from '@/features/sidebar';
import { ChatWindow, InputArea, useChatInitialization, useTauriEvents } from '@/features/chat';
import TaskStatus from './TaskStatus';

const SettingsModal = dynamic(() => import('@/features/settings').then(m => m.SettingsModal), { ssr: false });
const ModelLibrary = dynamic(() => import('@/features/library').then(m => m.ModelLibrary), { ssr: false });

// Connection Status Component
interface ConnectionStatusProps {
  isConnected: boolean;
  isChecking: boolean;
  onRetry: () => void;
}

const ConnectionStatus = ({ isConnected, isChecking, onRetry }: ConnectionStatusProps) => {
  const { globalSettings } = useSettingsStore();
  const { t } = useTranslation(globalSettings.language);

  return (
    <motion.div
    className="flex items-center gap-2"
    initial={false}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.2 }}
    >
    <AnimatePresence mode="wait">
    {isConnected && !isChecking && (
      <motion.div
      key="connected"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2"
      >
      <div className="w-2 h-2 rounded-full bg-green-500" />
      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
      {t('chat.localNode')}
      </span>
      </motion.div>
    )}

    {isChecking && (
      <motion.div
      key="checking"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400"
      >
      <Loader2 size={14} className="animate-spin" />
      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest hidden sm:inline">
      {t('chat.connecting')}
      </span>
      </motion.div>
    )}

    {!isConnected && !isChecking && (
      <motion.div
      key="offline"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2"
      >
      <div className="flex items-center gap-2">
      <WifiOff size={14} className="text-red-500" />
      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest hidden sm:inline">
      {t('chat.offline')}
      </span>
      </div>
      <button
      onClick={onRetry}
      className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-700 transition-colors"
      title="Retry connection"
      >
      <RotateCcw size={12} />
      <span className="hidden sm:inline">{t('common.retry')}</span>
      </button>
      </motion.div>
    )}
    </AnimatePresence>
    </motion.div>
  );
};

// Error Toast Component
interface ErrorToastProps {
  error: string;
  onDismiss: () => void;
  onHelp?: () => void;
}

const ErrorToast = ({ error, onDismiss, onHelp }: ErrorToastProps) => {
  const { globalSettings } = useSettingsStore();
  const { t } = useTranslation(globalSettings.language);

  const isOllamaError = error.toLowerCase().includes('ollama');
  const isNetworkError = error.toLowerCase().includes('network') || error.toLowerCase().includes('connect');

  return (
    <motion.div
    initial={{ opacity: 0, y: -10 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -10 }}
    className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md"
    >
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-2">
    <div className="flex items-start gap-3">
    <AlertCircle size={16} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
    <div className="flex-1 min-w-0">
    <p className="text-sm font-medium text-red-900 dark:text-red-200">
    {isOllamaError ? 'Ollama Connection Error' : 'Connection Error'}
    </p>
    <p className="text-xs text-red-700 dark:text-red-300 mt-1 line-clamp-2">
    {error}
    </p>
    {isOllamaError && (
      <p className="text-xs text-red-600 dark:text-red-400 mt-2">
      {t('error.startOllama')}
      </p>
    )}
    </div>
    </div>

    <div className="flex items-center gap-2 pt-2">
    {isOllamaError && onHelp && (
      <button
      onClick={onHelp}
      className="text-xs font-semibold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
      >
      {t('common.downloadOllama')}
      </button>
    )}
    <button
    onClick={onDismiss}
    className="ml-auto text-xs font-semibold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
    >
    Dismiss
    </button>
    </div>
    </div>
    </motion.div>
  );
};

export default function HomeClient() {
  const { globalSettings } = useSettingsStore();
  const { isHydrated, isOllamaConnected, isLibraryOpen, isSettingsOpen, setLibraryOpen, setSettingsOpen, error, setError } = useUIStore();
  const { initializeApp } = useChatInitialization();
  const [mounted, setMounted] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [showError, setShowError] = useState(!!error);
  const { t, isRtl } = useTranslation(globalSettings.language);

  useTauriEvents();
  useGlobalShortcuts();

  // Monitor error state
  useEffect(() => {
    if (error) {
      setShowError(true);
    }
  }, [error]);

  // Initialize app only once when hydrated
  useEffect(() => {
    setMounted(true);
    if (isHydrated) {
      setIsChecking(true);
      const initTimer = setTimeout(() => {
        initializeApp().finally(() => setIsChecking(false));
      }, 100);

      return () => clearTimeout(initTimer);
    }
  }, [isHydrated, initializeApp]);

  const isMac = useMemo(() => typeof window !== 'undefined' && navigator.userAgent.toUpperCase().includes('MAC'), []);
  const isTauri = checkIsTauri();

  const handleRetry = async () => {
    setIsChecking(true);
    try {
      await initializeApp();
    } finally {
      setIsChecking(false);
    }
  };

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
    <h1 className="font-black text-lg tracking-tighter text-foreground">
    {t('common.appName')}
    </h1>
    <div className="h-4 w-[1px] bg-zinc-200 dark:bg-zinc-800" />

    {/* Connection Status with Interactive Elements */}
    <div className="pointer-events-auto">
    <ConnectionStatus
    key="connection-status"
    isConnected={isOllamaConnected}
    isChecking={isChecking}
    onRetry={handleRetry}
    />
    </div>
    </div>

    <div className="flex items-center gap-4">
    <TaskStatus />
    <div className="flex items-center gap-1.5">
    <button
    onClick={() => setLibraryOpen(true)}
    className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all text-zinc-500 hover:text-foreground"
    title={t('library.title')}
    >
    <Library size={18} />
    <span className="text-xs font-bold uppercase tracking-widest hidden sm:inline">
    {t('library.title')}
    </span>
    </button>
    <button
    onClick={() => setSettingsOpen(true)}
    className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all text-zinc-500 hover:text-foreground"
    title={t('settings.title')}
    >
    <Sliders size={18} />
    </button>
    </div>
    </div>
    </header>

    <div className="flex-1 relative overflow-hidden flex flex-col">
    <ChatWindow />
    <div className="bg-gradient-to-t from-background via-background/90 to-transparent pt-12 pb-4 px-4 z-10">
    {isHydrated ? (
      <InputArea />
    ) : (
      <div className="animate-pulse bg-zinc-100 dark:bg-zinc-800 h-20 w-full max-w-4xl mx-auto rounded-[2rem]" />
    )}
    </div>
    </div>
    </div>

    {/* Error Toast */}
    <AnimatePresence>
    {showError && error && (
      <ErrorToast
      error={error}
      onDismiss={() => {
        setShowError(false);
        setError(null);
      }}
      onHelp={() => {
        // Handle opening Ollama download link if needed
      }}
      />
    )}
    </AnimatePresence>

    {/* Modals */}
    <AnimatePresence>
    {isSettingsOpen && (
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />
    )}
    {isLibraryOpen && (
      <ModelLibrary isOpen={isLibraryOpen} onClose={() => setLibraryOpen(false)} />
    )}
    </AnimatePresence>
    </main>
  );
}
