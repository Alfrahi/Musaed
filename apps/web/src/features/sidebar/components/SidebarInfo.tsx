"use client";

import React from 'react';
import { Info } from 'lucide-react';
import { useSetInfoOpen, useLanguage } from '../../../store/hooks';
import { useTranslation } from '../../../lib/i18n';

const SidebarInfo = () => {
  const setInfoOpen = useSetInfoOpen();
  const language = useLanguage();
  const { t } = useTranslation(language);
  const version = "0.1.0";

  return (
    <div className="border-bs border-sidebar-border bg-zinc-50/50 dark:bg-zinc-900/20 shrink-0">
      <button 
        onClick={() => setInfoOpen(true)}
        className="w-full p-4 flex items-center justify-between group hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-all text-start"
        aria-label={t('info.openInfo')}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-900 shrink-0 shadow-sm">
            <Info size={16} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold truncate dark:text-zinc-200 leading-none mbe-1">
              {t('common.appName')}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              v{version}
            </span>
          </div>
        </div>
      </button>
    </div>
  );
};

export default SidebarInfo;