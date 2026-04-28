"use client";

import { usePullStatus, useLanguage } from '@/store/hooks';
import { useTranslation } from '@/lib/i18n';
import { Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMemo } from 'react';

const TaskStatus = () => {
  const pullStatus = usePullStatus();
  const language = useLanguage();
  const { t } = useTranslation(language);

  const activeTasks = useMemo(() => {
    return Object.entries(pullStatus).filter(([_, status]) => status !== null);
  }, [pullStatus]);

  if (activeTasks.length === 0) return null;

  // We show the first active task. Ollama usually processes pulls sequentially.
  const [name, status] = activeTasks[0];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={name}
        initial={{ opacity: 0, y: -10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.95 }}
        className="flex items-center gap-3 ps-3 pe-4 py-1.5 bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-sm"
      >
        <div className="relative flex items-center justify-center">
          <Loader2 size={14} className="animate-spin text-blue-500" aria-hidden="true" />
          {status?.progress !== undefined && (
            <div className="absolute inset-0 flex items-center justify-center">
              {/* Optional: could add a radial progress here in the future */}
            </div>
          )}
        </div>
        
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-widest truncate max-w-[100px]">
              {name === 'current' ? t('library.pulling') : name}
            </span>
            {status?.progress !== undefined && (
              <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 font-mono">
                {status.progress}%
              </span>
            )}
          </div>
          <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-[0.1em] leading-none">
            {t('library.pulling')}
          </span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default TaskStatus;