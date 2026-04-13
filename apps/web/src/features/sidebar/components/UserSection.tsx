"use client";

import { useSettingsStore } from '../../../store';
import { useTranslation } from '../../../lib/i18n';

const UserSection = () => {
  const { globalSettings } = useSettingsStore();
  const { t } = useTranslation(globalSettings.language);

  return (
    <div className="p-4 border-t border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center gap-3 ps-2 pe-2">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-bold">
          {t('chat.localUser').substring(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold truncate dark:text-zinc-200">{t('chat.localUser')}</p>
        </div>
      </div>
    </div>
  );
};

export default UserSection;