"use client";

import { Plus } from 'lucide-react';
import { useLanguage } from '@/store/hooks';
import { useTranslation } from '@/lib/i18n';
import { useConversationActions } from '@/features/chat';

const SidebarHeader = () => {
  const language = useLanguage();
  const { createNewConversation } = useConversationActions();
  const { t } = useTranslation(language);

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex gap-2">
        <button
          onClick={createNewConversation}
          className="flex-1 flex items-center justify-center gap-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 h-10 ps-4 pe-4 rounded-lg hover:opacity-90 transition-all font-bold text-xs uppercase tracking-widest shadow-sm active:scale-95"
        >
          <Plus size={16} />
          {t('sidebar.newChat')}
        </button>
      </div>
    </div>
  );
};

export default SidebarHeader;