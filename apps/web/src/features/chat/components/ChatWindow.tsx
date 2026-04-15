"use client";

import { useRef, useEffect, useState } from 'react';
import { Bot, ArrowDown, Plus, Sparkles, Shield } from 'lucide-react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useConversationStore, useSettingsStore, useUIStore } from '../../../store';
import MessageBubble from './MessageBubble';
import ChatWindowSkeleton from './ChatWindowSkeleton';
import { useTranslation } from '../../../lib/i18n';
import { cn } from '../../../lib/utils';
import { useConversationActions } from '../hooks/useConversationActions';

const ChatWindow = () => {
  const { conversations, currentConversationId } = useConversationStore();
  const { globalSettings } = useSettingsStore();
  const { isHydrated } = useUIStore();
  const { createNewConversation } = useConversationActions();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const { t } = useTranslation(globalSettings.language);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const currentConversation = currentConversationId ? conversations[currentConversationId] : null;

  useEffect(() => {
    if (virtuosoRef.current && currentConversation?.messages.length) {
      virtuosoRef.current.scrollToIndex({
        index: currentConversation.messages.length - 1,
        align: 'end',
        behavior: 'auto'
      });
    }
  }, [currentConversation?.messages.length, currentConversation?.messages[currentConversation?.messages.length - 1]?.content]);

  const scrollToBottom = () => {
    if (virtuosoRef.current && currentConversation) {
      virtuosoRef.current.scrollToIndex({
        index: currentConversation.messages.length - 1,
        align: 'end',
        behavior: 'smooth'
      });
    }
  };

  if (!isHydrated) {
    return <ChatWindowSkeleton />;
  }

  if (!currentConversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center ps-8 pe-8 bg-zinc-50/30 dark:bg-zinc-950">
        <div className="relative mbe-8">
          <div className="w-20 h-20 bg-white dark:bg-zinc-900 rounded-3xl flex items-center justify-center shadow-xl border border-zinc-100 dark:border-zinc-800 rotate-3 animate-pulse">
            <Bot size={40} className="text-blue-600" />
          </div>
          <div className="absolute inset-be-[-0.5rem] inset-ie-[-0.5rem] w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg -rotate-12">
            <Sparkles size={16} />
          </div>
        </div>

        <h2 className="text-2xl font-black text-zinc-900 dark:text-zinc-100 mbe-2 tracking-tight">
          {t('chat.welcome', { appName: t('common.appName') })}
        </h2>
        <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400 text-center mbe-10 leading-relaxed">
          {t('chat.selectConversation')}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
          <button 
            onClick={createNewConversation}
            className="flex items-center gap-4 p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl hover:border-blue-500 dark:hover:border-blue-500 transition-all text-start group"
          >
            <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-blue-600 transition-colors">
              <Plus size={20} />
            </div>
            <div>
              <p className="text-sm font-bold">{t('sidebar.newChat')}</p>
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mbs-0.5">{t('chat.startFresh')}</p>
            </div>
          </button>
          
          <div className="flex items-center gap-4 p-4 bg-zinc-100/50 dark:bg-zinc-900/50 border border-transparent rounded-2xl text-start opacity-60">
            <div className="w-10 h-10 rounded-xl bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-zinc-400">
              <Shield size={20} />
            </div>
            <div>
              <p className="text-sm font-bold">{t('chat.privateNote')}</p>
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mbs-0.5">{t('chat.runningLocally')}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative overflow-hidden">
      <Virtuoso
        ref={virtuosoRef}
        className="h-full"
        data={currentConversation.messages}
        atBottomThreshold={60}
        atBottomStateChange={(atBottom) => setShowScrollButton(!atBottom)}
        itemContent={(index, msg) => (
          <div className={cn(index === currentConversation.messages.length - 1 && "pbe-32")}>
            <MessageBubble message={msg} />
          </div>
        )}
        followOutput="smooth"
      />

      {showScrollButton && currentConversation.messages.length > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute inset-be-28 inset-is-1/2 -translate-is-1/2 p-2 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-300 rounded-full shadow-lg border border-zinc-200 dark:border-zinc-700 hover:text-blue-500 transition-all z-20"
          aria-label={t('common.done')}
        >
          <ArrowDown size={20} />
        </button>
      )}
    </div>
  );
};

export default ChatWindow;