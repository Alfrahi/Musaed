'use client';

import { Info } from 'lucide-react';
import { useOpenModal } from '@/store/hooks';
import { useLanguage } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useAppVersion } from '@/hooks';

const SidebarInfo = ({ trailing }: { trailing?: React.ReactNode }) => {
  const openModal = useOpenModal();
  const language = useLanguage();
  const { t } = useTranslation(language);
  const { version } = useAppVersion();

  return (
    <div className="border-bs border-sidebar-border duration-fast flex items-center gap-1 bg-zinc-50/50 p-4 transition-colors dark:bg-zinc-900/20">
      <Button
        variant="ghost"
        onClick={() => openModal('info')}
        className="group flex min-w-0 flex-1 cursor-pointer items-center justify-start gap-3 p-0 text-start hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
        aria-label={t('info.openInfo')}
      >
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
      </Button>
      {trailing}
    </div>
  );
};

export default SidebarInfo;
