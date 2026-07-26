'use client';

import { useModelStore } from '@/store/model-store';
import { useSettingsStore } from '@/store/settings-store';
import { useTranslation } from '@/lib/i18n';
import { Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMemo } from 'react';

const TaskStatus = () => {
  const pullStatus = useModelStore((s) => s.pullStatus);
  const language = useSettingsStore((s) => s.globalSettings.language);
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
        className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-100 py-1.5 ps-3 pe-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800/80"
      >
        <div className="relative flex items-center justify-center">
          <Loader2 size={14} className="animate-spin text-blue-500" aria-hidden="true" />
          {status?.progress !== undefined && (
            <div className="absolute inset-0 flex items-center justify-center">
              {/* Optional: could add a radial progress here in the future */}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className="caption-md max-w-[100px] truncate font-bold tracking-widest text-zinc-900 uppercase dark:text-zinc-100">
              {name === 'current' ? t('library.pulling') : name}
            </span>
            {status?.progress !== undefined && (
              <span className="caption-xs font-mono font-black text-blue-600 dark:text-blue-400">
                {status.progress}%
              </span>
            )}
          </div>
          <span className="caption-xs leading-none font-bold tracking-[0.1em] uppercase">
            {t('library.pulling')}
          </span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default TaskStatus;
