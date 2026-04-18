"use client";

import { ShieldCheck, User } from 'lucide-react';
import { useSettingsStore } from '../../../store';
import { useTranslation } from '../../../lib/i18n';

const UserSection = () => {
  const { globalSettings } = useSettingsStore();
  const { t } = useTranslation(globalSettings.language);

  return (
    <div className="border-t border-sidebar-border bg-zinc-50/50 dark:bg-zinc-900/20">
      <div className="p-3 flex items-center justify-between group">
        <div className="flex items-center gap-3 ps-1 min-w-0">
          <div className="w-8 h-8 bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-900 shrink-0">
            <User size={16} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold truncate dark:text-zinc-200 leading-none mbe-1">
              {t('chat.localUser')}
            </span>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-none bg-green-500" />
              <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                {t('common.active')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserSection;