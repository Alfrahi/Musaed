'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowDown } from 'lucide-react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useUIStore } from '@/store/ui-store';
import {
  useConversationStore,
  selectCurrentConversation,
} from '@/features/conversation/store/conversation-store';
import {
  useStreamingStore,
  selectLiveContent,
} from '@/features/conversation/store/streaming-store';
import { useMessageStore } from '@/features/conversation/store/message-store';
import type { StreamingState } from '@/features/conversation/store/streaming-store';
import { useSettingsStore } from '@/features/settings';
import MessageBubble from './MessageBubble';
import ChatWindowSkeleton from './ChatWindowSkeleton';
import EmptyState from './EmptyState';
import { useTranslation, type TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { type Message } from '@musaed/contracts';

interface MessageLabels {
  user: string;
  assistant: string;
  copy: string;
  tokens: string;
}

/** Pre-resolved translated labels shared across all message bubbles. */
const useMessageLabels = (
  t: (key: TranslationKey | string, values?: Record<string, string | number | boolean>) => string
): MessageLabels =>
  useMemo(
    () => ({
      user: t('chat.user'),
      assistant: t('chat.assistant'),
      copy: t('common.copy'),
      tokens: t('chat.tokens'),
    }),
    [t]
  );

/** Floating scroll-to-bottom button. */
const ScrollButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <div className="inset-be-6 pointer-events-none absolute start-1/2 z-20 flex -translate-x-1/2 justify-center">
    <button
      onClick={onClick}
      className="pointer-events-auto rounded-none border border-zinc-200 bg-white p-2 text-zinc-500 shadow-lg transition-all hover:text-blue-500 active:scale-95 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
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
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const storedMessages = useMessageStore((s) =>
    currentConversationId ? s.messages[currentConversationId] : []
  );
  const activeStreams = useStreamingStore((s: StreamingState) => s.activeStreams);
  const isHydrated = useUIStore((s) => s.isHydrated);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const { t, formatNumber } = useTranslation(language);
  const messageLabels = useMessageLabels(t);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Live streaming content — only the last message's buffer changes frequently
  const isStreaming = currentConversationId ? !!activeStreams[currentConversationId] : false;
  const liveContent = useStreamingStore(
    currentConversationId ? selectLiveContent(currentConversationId) : () => null
  );

  // Build the messages list: replace last message content with live buffer during streaming
  const messages: Message[] = useMemo(() => {
    if (!storedMessages || storedMessages.length === 0) return [];

    if (!isStreaming || !liveContent) return storedMessages;

    const lastIdx = storedMessages.length - 1;
    return storedMessages.map((msg, i) =>
      i === lastIdx ? { ...msg, content: msg.content + liveContent } : msg
    );
  }, [storedMessages, isStreaming, liveContent]);

  const lastMsgCount = messages.length;

  // Auto-scroll on new messages and when streaming content updates
  useEffect(() => {
    if (virtuosoRef.current && lastMsgCount) {
      virtuosoRef.current.scrollToIndex({
        index: lastMsgCount - 1,
        align: 'end',
        behavior: 'auto',
      });
    }
  }, [lastMsgCount, liveContent]);

  const scrollToBottom = useCallback(() => {
    if (virtuosoRef.current && messages.length > 0) {
      virtuosoRef.current.scrollToIndex({
        index: messages.length - 1,
        align: 'end',
        behavior: 'smooth',
      });
    }
  }, [messages.length]);

  if (!isHydrated) return <ChatWindowSkeleton />;
  if (!currentConversation) return <EmptyState />;

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <Virtuoso
        ref={virtuosoRef}
        className="h-full"
        data={messages}
        atBottomThreshold={60}
        atBottomStateChange={(atBottom) => setShowScrollButton(!atBottom)}
        itemContent={(index, msg) => (
          <div className={cn(index === messages.length - 1 && 'pbe-32')}>
            <MessageBubble message={msg} labels={messageLabels} formatNumber={formatNumber} />
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
