'use client';

import { Info } from 'lucide-react';
import { useOpenModal } from '@/store/hooks';
import { useLanguage } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useAppVersion } from '@/hooks';

const SidebarInfo = () => {
  const openModal = useOpenModal();
  const language = useLanguage();
  const { t } = useTranslation(language);
  const { version } = useAppVersion();

  return (
    <div className="border-bs border-sidebar-border duration-fast shrink-0 bg-zinc-50/50 transition-colors dark:bg-zinc-900/20">
      <Button
        variant="ghost"
        onClick={() => openModal('info')}
        className="group flex w-full cursor-pointer items-center justify-between p-4 text-start hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
        aria-label={t('info.openInfo')}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="shadow-native flex h-8 w-8 shrink-0 items-center justify-center bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
            <Info size={16} />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="mbe-1 text-caption truncate leading-none font-bold dark:text-zinc-200">
              {t('common.appName')}
            </span>
            {version && (
              <span className="caption-md font-bold tracking-widest text-zinc-500 uppercase">
                v{version}
              </span>
            )}
          </div>
        </div>
      </Button>
    </div>
  );
};

export default SidebarInfo;
