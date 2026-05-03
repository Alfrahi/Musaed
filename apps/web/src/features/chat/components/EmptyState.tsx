'use client';

import { Bot, Plus, Sparkles, Shield } from 'lucide-react';
import { useGlobalSettings } from '../../../store/hooks';
import { useConversationActions } from '../hooks/useConversationActions';
import { useTranslation } from '../../../lib/i18n';

/** Welcome screen shown when no conversation is active. */
const EmptyState = () => {
  const { createNewConversation } = useConversationActions();
  const globalSettings = useGlobalSettings();
  const { t } = useTranslation(globalSettings.language);

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50/30 ps-8 pe-8 dark:bg-zinc-950">
      <div className="mbe-8 relative">
        <div className="flex h-20 w-20 rotate-3 items-center justify-center rounded-none border border-zinc-100 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <Bot size={40} className="text-blue-600" />
        </div>
        <div className="inset-be-[-0.5rem] inset-ie-[-0.5rem] absolute flex h-8 w-8 -rotate-12 items-center justify-center rounded-none bg-blue-600 text-white shadow-lg">
          <Sparkles size={16} />
        </div>
      </div>

      <h2 className="mbe-2 text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-100">
        {t('chat.welcome', { appName: t('common.appName') })}
      </h2>
      <p className="mbe-10 max-w-md text-center text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
        {t('chat.selectConversation')}
      </p>

      <div className="grid w-full max-w-lg grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          onClick={createNewConversation}
          className="group flex items-center gap-4 rounded-none border border-zinc-200 bg-white p-4 text-start transition-all hover:border-blue-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-500"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-none bg-zinc-100 text-zinc-500 transition-colors group-hover:text-blue-600 dark:bg-zinc-800">
            <Plus size={20} />
          </div>
          <div>
            <p className="text-sm font-bold">{t('sidebar.newChat')}</p>
            <p className="mbs-0.5 text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
              {t('chat.startFresh')}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-4 rounded-none border border-transparent bg-zinc-100/50 p-4 text-start opacity-60 dark:bg-zinc-900/50">
          <div className="flex h-10 w-10 items-center justify-center rounded-none bg-zinc-200 text-zinc-400 dark:bg-zinc-800">
            <Shield size={20} />
          </div>
          <div>
            <p className="text-sm font-bold">{t('chat.privateNote')}</p>
            <p className="mbs-0.5 text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
              {t('chat.runningLocally')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmptyState;
