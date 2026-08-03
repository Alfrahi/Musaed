'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowDown } from 'lucide-react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useUIStore } from '@/store/ui-store';
import { useConversationStore, selectCurrentConversation } from '@/store/conversation-store';
import { useStreamingStore, selectLiveContent } from '@/store/streaming-store';
import { useMessageStore } from '@/store/message-store';
import type { StreamingState } from '@/store/streaming-store';
import { useSettingsStore } from '@/store';
import { useModelStore } from '@/store/model-store';
import { ErrorFallback, ScrollShadow } from '@/components/ui';
import { Button } from '@/components/ui/button';
import MessageBubble from './MessageBubble';
import ChatWindowSkeleton from './ChatWindowSkeleton';
import EmptyState, { type OnboardingState } from './EmptyState';
import { useChatSend } from '../hooks/useChatSend';
import { useRegenerateMessage } from '../hooks/useRegenerateMessage';
import { fireEditPrompt } from '../utils/edit-prompt-signal';
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

/** Floating scroll-to-bottom button with optional unread count badge. */
const ScrollButton = ({
  onClick,
  label,
  unreadCount = 0,
}: {
  onClick: () => void;
  label: string;
  unreadCount?: number;
}) => (
  <div className="inset-be-6 pointer-events-none absolute start-1/2 z-20 flex -translate-x-1/2 justify-center">
    <Button
      variant="outline"
      size="icon"
      onClick={onClick}
      className="pointer-events-auto relative rounded-md border-zinc-200 bg-white text-zinc-500 shadow-lg hover:text-blue-500 active:scale-95 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
      aria-label={label}
    >
      <ArrowDown size={20} />
      {unreadCount > 0 && (
        <span className="caption-xs absolute -end-2 -top-2 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 leading-none font-bold text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Button>
  </div>
);

/**
 * Hook: message bubble action callbacks for Prompt 14 (Continue, Edit prompt, Edit).
 * Extracted to keep ChatWindow under the max-lines-per-function lint gate.
 */
function useMessageBubbleActions(
  currentConversationId: string | null,
  messages: Message[],
  sendMessage: (input: string, images?: string[]) => void,
  onEditPrompt: (prompt: string) => void
) {
  const handleRetry = useCallback(() => {
    if (!currentConversationId) return;
    const lastUser = messages.findLast((m) => m.role === 'user');
    if (!lastUser) return;
    useUIStore.getState().setErrorMessage(null);
    void sendMessage(lastUser.content, lastUser.images ?? []);
  }, [currentConversationId, messages, sendMessage]);

  const handleContinue = useCallback(() => {
    if (!currentConversationId) return;
    const lastUser = messages.findLast((m) => m.role === 'user');
    if (!lastUser) return;
    useUIStore.getState().setErrorMessage(null);
    void sendMessage(lastUser.content, lastUser.images ?? []);
  }, [currentConversationId, messages, sendMessage]);

  const handleEditPrompt = useCallback(
    (assistantMsgId: string) => {
      const assistantIdx = messages.findIndex((m) => m.id === assistantMsgId);
      if (assistantIdx === -1) return;
      const lastUser = messages.slice(0, assistantIdx).findLast((m) => m.role === 'user');
      if (!lastUser) return;
      onEditPrompt(lastUser.content);
    },
    [messages, onEditPrompt]
  );

  const handleEdit = useCallback(
    (userMsgId: string) => {
      const msg = messages.find((m) => m.id === userMsgId);
      if (!msg || msg.role !== 'user') return;
      onEditPrompt(msg.content);
    },
    [messages, onEditPrompt]
  );

  return { handleRetry, handleContinue, handleEditPrompt, handleEdit };
}

/**
 * Derive the onboarding state for the empty/welcome screen. Onboarding CTAs
 * take priority over the standard welcome message when the system isn't ready
 * for chat (no models installed or Ollama unreachable).
 */
function getOnboardingState(
  currentConversation: unknown,
  modelsLength: number,
  isOllamaConnected: boolean,
  onInstallModel?: () => void,
  onStartOllama?: () => void
): OnboardingState | undefined {
  if (currentConversation) return undefined;
  if (modelsLength > 0 && isOllamaConnected) return undefined;
  return {
    noModels: modelsLength === 0,
    ollamaOffline: !isOllamaConnected,
    onInstallModel: onInstallModel ?? (() => {}),
    onStartOllama: onStartOllama ?? (() => {}),
  };
}

/**
 * Hook: builds the virtualized message list (merging live streaming content
 * into the last message) and manages auto-scroll behavior.
 */
function useVirtualizedMessages(
  currentConversationId: string | null,
  storedMessages: Message[] | undefined,
  activeStreams: StreamingState['activeStreams']
) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isAtBottomRef = useRef(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevMsgCountRef = useRef(0);

  const isStreaming = currentConversationId ? !!activeStreams[currentConversationId] : false;
  const liveContent = useStreamingStore(
    currentConversationId ? selectLiveContent(currentConversationId) : () => null
  );

  const messages: Message[] = useMemo(() => {
    if (!storedMessages || storedMessages.length === 0) return [];
    if (!isStreaming || !liveContent) return storedMessages;
    const lastIdx = storedMessages.length - 1;
    return storedMessages.map((msg, i) =>
      i === lastIdx ? { ...msg, content: msg.content + liveContent } : msg
    );
  }, [storedMessages, isStreaming, liveContent]);

  const lastMsgCount = messages.length;

  useEffect(() => {
    if (virtuosoRef.current && lastMsgCount) {
      virtuosoRef.current.scrollToIndex({
        index: lastMsgCount - 1,
        align: 'end',
        behavior: 'auto',
      });
    }
  }, [lastMsgCount, liveContent]);

  // Track new messages that arrive while the user is scrolled up.
  useEffect(() => {
    const delta = lastMsgCount - prevMsgCountRef.current;
    if (delta > 0 && !isAtBottomRef.current) {
      setUnreadCount((c) => c + delta);
    }
    prevMsgCountRef.current = lastMsgCount;
  }, [lastMsgCount]);

  // Reset unread count when conversation changes.
  useEffect(() => {
    setUnreadCount(0);
    prevMsgCountRef.current = 0;
  }, [currentConversationId]);

  const scrollToBottom = useCallback(() => {
    if (virtuosoRef.current && messages.length > 0) {
      virtuosoRef.current.scrollToIndex({
        index: messages.length - 1,
        align: 'end',
        behavior: 'smooth',
      });
    }
    setUnreadCount(0);
  }, [messages.length]);

  return {
    virtuosoRef,
    messages,
    showScrollButton,
    setShowScrollButton,
    scrollToBottom,
    unreadCount,
    isAtBottomRef,
  };
}

/**
 * Main chat window with virtualized messages.
 *
 * Accepts onboarding callbacks so the parent composition root (HomeClient)
 * can wire first-run CTAs without EmptyState reaching across feature boundaries.
 */
const ChatWindow = ({
  onInstallModel,
  onStartOllama,
}: {
  onInstallModel?: () => void;
  onStartOllama?: () => void;
} = {}) => {
  const currentConversation = useConversationStore(selectCurrentConversation);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const storedMessages = useMessageStore((s) =>
    currentConversationId ? s.messages[currentConversationId] : []
  );
  const activeStreams = useStreamingStore((s: StreamingState) => s.activeStreams);
  const isHydrated = useUIStore((s) => s.isHydrated);
  const isOllamaConnected = useUIStore((s) => s.isOllamaConnected);
  const models = useModelStore((s) => s.models);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { sendMessage } = useChatSend();
  const { t, formatNumber } = useTranslation(language);
  const messageLabels = useMessageLabels(t);

  const {
    virtuosoRef,
    messages,
    showScrollButton,
    setShowScrollButton,
    scrollToBottom,
    unreadCount,
    isAtBottomRef,
  } = useVirtualizedMessages(currentConversationId, storedMessages, activeStreams);

  // Detect a structured `error` on the last assistant message — replaces the
  // legacy `content.includes('[Error:')` substring heuristic (Prompt 8).
  const lastError = messages.length > 0 ? messages.findLast((m) => m.error)?.error : undefined;
  const hasError = Boolean(lastError);

  // Regenerate: find the last user message before the given assistant message
  // and re-invoke `sendMessage` with its content. Used by the context menu on
  // assistant bubbles (audit F13, Prompt 12).
  const { regenerateMessage } = useRegenerateMessage(currentConversationId, messages, sendMessage);

  // Continue / Edit prompt / Edit / Retry callbacks (Prompt 14).
  const { handleRetry, handleContinue, handleEditPrompt, handleEdit } = useMessageBubbleActions(
    currentConversationId,
    messages,
    sendMessage,
    fireEditPrompt
  );

  const onboarding = getOnboardingState(
    currentConversation,
    models.length,
    isOllamaConnected,
    onInstallModel,
    onStartOllama
  );

  if (!isHydrated) return <ChatWindowSkeleton />;
  if (!currentConversation) return <EmptyState onboarding={onboarding} />;

  return (
    <div data-testid="chat-window" className="relative flex flex-1 flex-col overflow-hidden">
      <Virtuoso
        ref={virtuosoRef}
        className="h-full"
        data={messages}
        atBottomThreshold={60}
        atBottomStateChange={(atBottom) => {
          isAtBottomRef.current = atBottom;
          setShowScrollButton(!atBottom);
        }}
        itemContent={(index, msg) => (
          <div className={cn(index === messages.length - 1 && 'pbe-32')}>
            <MessageBubble
              message={msg}
              labels={messageLabels}
              formatNumber={formatNumber}
              onRegenerate={() => regenerateMessage(msg.id)}
              onContinue={handleContinue}
              onEditPrompt={() => handleEditPrompt(msg.id)}
              onEdit={() => handleEdit(msg.id)}
            />
          </div>
        )}
        followOutput="smooth"
      />
      <ScrollShadow visible={showScrollButton && messages.length > 0} />
      {showScrollButton && messages.length > 0 && (
        <ScrollButton onClick={scrollToBottom} label={t('common.done')} unreadCount={unreadCount} />
      )}
      {hasError && (
        <div className="absolute inset-x-0 bottom-0 border-t border-zinc-200 bg-white/95 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95">
          <ErrorFallback
            type="ollama"
            compact
            className="flex-row py-3"
            description={lastError?.message}
            onRetry={handleRetry}
          />
        </div>
      )}
    </div>
  );
};

export default ChatWindow;
