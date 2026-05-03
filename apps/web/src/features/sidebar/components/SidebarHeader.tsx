'use client';

import { Plus } from 'lucide-react';
import { useLanguage } from '@/store/hooks';
import { useTranslation } from '@/lib/i18n';
import { useConversationActions } from '@/features/chat';

const SidebarHeader = () => {
  const language = useLanguage();
  const { createNewConversation } = useConversationActions();
  const { t } = useTranslation(language);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex gap-2">
        <button
          onClick={createNewConversation}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-zinc-900 ps-4 pe-4 text-xs font-bold tracking-widest text-white uppercase shadow-sm transition-all hover:opacity-90 active:scale-95 dark:bg-zinc-100 dark:text-zinc-900"
        >
          <Plus size={16} />
          {t('sidebar.newChat')}
        </button>
      </div>
    </div>
  );
};

export default SidebarHeader;
