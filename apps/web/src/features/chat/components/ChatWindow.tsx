"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowDown } from 'lucide-react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useGlobalSettings, useIsHydrated, useActiveStreams, useCurrentConversationId } from '../../../store/hooks';
import { useConversationStore, selectCurrentConversation } from '../../../store/stores/conversation-store';
import { useStreamingStore, selectLiveContent } from '../../../store/stores/streaming-store';
import MessageBubble from './MessageBubble';
import ChatWindowSkeleton from './ChatWindowSkeleton';
import EmptyState from './EmptyState';
import { useTranslation } from '../../../lib/i18n';
import { cn } from '../../../lib/utils';
import { Message } from '@musaed/contracts';

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
  const currentConversationId = useCurrentConversationId();
  const activeStreams = useActiveStreams();
  const globalSettings = useGlobalSettings();
  const isHydrated = useIsHydrated();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const { t } = useTranslation(globalSettings.language);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Live streaming content — only the last message's buffer changes frequently
  const isStreaming = currentConversationId ? !!activeStreams[currentConversationId] : false;
  const liveContent = useStreamingStore(
    currentConversationId ? selectLiveContent(currentConversationId) : () => null,
  );

  // Build the messages list: replace last message content with live buffer during streaming
  const messages: Message[] = useMemo(() => {
    const msgs = currentConversation?.messages;
    if (!msgs || msgs.length === 0) return [];

    if (!isStreaming || !liveContent) return msgs;

    const lastIdx = msgs.length - 1;
    return msgs.map((msg, i) =>
      i === lastIdx ? { ...msg, content: msg.content + liveContent } : msg,
    );
  }, [currentConversation?.messages, isStreaming, liveContent]);

  const lastMsgCount = messages.length;

  // Auto-scroll on new messages and when streaming content updates
  useEffect(() => {
    if (virtuosoRef.current && lastMsgCount) {
      virtuosoRef.current.scrollToIndex({ index: lastMsgCount - 1, align: 'end', behavior: 'auto' });
    }
  }, [lastMsgCount, liveContent]);

  const scrollToBottom = useCallback(() => {
    if (virtuosoRef.current && messages.length > 0) {
      virtuosoRef.current.scrollToIndex({ index: messages.length - 1, align: 'end', behavior: 'smooth' });
    }
  }, [messages.length]);

  if (!isHydrated) return <ChatWindowSkeleton />;
  if (!currentConversation) return <EmptyState />;

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col">
      <Virtuoso
        ref={virtuosoRef}
        className="h-full"
        data={messages}
        atBottomThreshold={60}
        atBottomStateChange={(atBottom) => setShowScrollButton(!atBottom)}
        itemContent={(index, msg) => (
          <div className={cn(index === messages.length - 1 && "pbe-32")}>
            <MessageBubble message={msg} />
          </div>
        )}
        followOutput="smooth"
      />
      {showScrollButton && messages.length > 0 && (
        <ScrollButton onClick={scrollToBottom} label={t('common.done')} />
      )}
    </div>
  );
};

export default ChatWindow;
