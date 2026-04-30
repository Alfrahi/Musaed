"use client";

import { useRef, useEffect, useState, useCallback } from 'react';
import { ArrowDown } from 'lucide-react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useGlobalSettings, useIsHydrated } from '../../../store/hooks';
import { useConversationStore, selectCurrentConversation } from '../../../store/stores/conversation-store';
import MessageBubble from './MessageBubble';
import ChatWindowSkeleton from './ChatWindowSkeleton';
import EmptyState from './EmptyState';
import { useTranslation } from '../../../lib/i18n';
import { cn } from '../../../lib/utils';

/** Floating scroll-to-bottom button. */
const ScrollButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <div className="absolute inset-be-6 start-1/2 -translate-x-1/2 flex justify-center pointer-events-none z-20">
    <button
      onClick={onClick}
      className="p-2 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-300 rounded-none shadow-lg border border-zinc-200 dark:border-zinc-700 hover:text-blue-500 transition-all pointer-events-auto active:scale-95"
      aria-label={label}
    >
      <ArrowDown size={20} />
    </button>
  </div>
);

/**
 * Main chat window with virtualized messages.
 */
const ChatWindow = () => {
  const currentConversation = useConversationStore(selectCurrentConversation);
  const globalSettings = useGlobalSettings();
  const isHydrated = useIsHydrated();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const { t } = useTranslation(globalSettings.language);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const lastMsgCount = currentConversation?.messages.length;
  const lastMsgContent = currentConversation?.messages.at(-1)?.content;

  useEffect(() => {
    if (virtuosoRef.current && lastMsgCount) {
      virtuosoRef.current.scrollToIndex({ index: lastMsgCount - 1, align: 'end', behavior: 'auto' });
    }
  }, [lastMsgCount, lastMsgContent]);

  const scrollToBottom = useCallback(() => {
    if (virtuosoRef.current && currentConversation) {
      virtuosoRef.current.scrollToIndex({ index: currentConversation.messages.length - 1, align: 'end', behavior: 'smooth' });
    }
  }, [currentConversation]);

  if (!isHydrated) return <ChatWindowSkeleton />;
  if (!currentConversation) return <EmptyState />;

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col">
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
        <ScrollButton onClick={scrollToBottom} label={t('common.done')} />
      )}
    </div>
  );
};

export default ChatWindow;
