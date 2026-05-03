'use client';

import { Info } from 'lucide-react';
import { useSetInfoOpen, useLanguage } from '../../../store/hooks';
import { useTranslation } from '../../../lib/i18n';

const SidebarInfo = () => {
  const setInfoOpen = useSetInfoOpen();
  const language = useLanguage();
  const { t } = useTranslation(language);
  const version = '0.1.0';

  return (
    <div className="border-bs border-sidebar-border shrink-0 bg-zinc-50/50 dark:bg-zinc-900/20">
      <button
        onClick={() => setInfoOpen(true)}
        className="group flex w-full items-center justify-between p-4 text-start transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
        aria-label={t('info.openInfo')}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900">
            <Info size={16} />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="mbe-1 truncate text-xs leading-none font-bold dark:text-zinc-200">
              {t('common.appName')}
            </span>
            <span className="text-[9px] font-bold tracking-widest text-zinc-500 uppercase">
              v{version}
            </span>
          </div>
        </div>
      </button>
    </div>
  );
};

export default SidebarInfo;
