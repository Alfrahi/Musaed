'use client';

import { useMemo } from 'react';
import { useMessageStore } from '@/store/message-store';
import { useSettingsStore } from '@/store/settings-store';
import { useModelStore } from '@/store/model-store';
import { useCurrentConversationId, useConversations } from '@/store/conversation-store';
import { useModelContextWindow } from '@/features/library';
import { useTranslation } from '@/lib/i18n';
import { useConversationActions } from './useConversationActions';
import { type FileAttachment } from './useAttachmentUtils';
import { useChatRag, type ChatRagSource } from './useChatRag';
import { useChatStream } from './useChatStream';
import { ChatSendService } from '../services/ChatSendService';

export type { ChatRagSource };

/**
 * Thin React facade over {@link ChatSendService}.
 *
 * Responsible only for:
 * - Reading React-reactive state (stores, sibling hooks) so the component
 *   tree re-renders when these values change.
 * - Constructing a fresh `ChatSendService` with the current render's
 *   dependencies so the service always sees up-to-date `t`, `contextWindow`,
 *   etc.
 *
 * All send-pipeline logic (validation, RAG assembly, message creation,
 * chatApi.chat, persistence, error handling, stream cleanup) lives in the
 * framework-agnostic service class, which is independently testable without
 * React.
 */
export function useChatSend(): {
  sendMessage: (input: string, images?: string[], files?: FileAttachment[]) => Promise<void>;
  editAndResend: (editedMessageId: string, newContent: string, images?: string[]) => Promise<void>;
} {
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const paramsStop = useSettingsStore((s) => s.globalSettings.stop);
  // Subscribe so the component re-renders when messages change.
  const messageStore = useMessageStore();
  // Subscribe so the component re-renders when conversation/model changes.
  const _currentConversationId = useCurrentConversationId();
  const _conversations = useConversations();
  const _modelStore = useModelStore();
  const { assembleChatRag } = useChatRag();
  const { handleStreamError } = useChatStream();
  const { initiateStreaming } = useConversationActions();
  const { contextWindow, defaultParams } = useModelContextWindow();

  // Suppress unused-variable warnings — these hooks are called so React
  // subscribes to the right slices and the component re-renders when
  // dependencies change. The service reads fresh state via `.getState()`
  // at call time; these hook return values are intentionally unused here.
  void messageStore;
  void _currentConversationId;
  void _conversations;
  void _modelStore;

  const service = useMemo(
    () =>
      new ChatSendService({
        t,
        assembleChatRag,
        handleStreamError,
        initiateStreaming,
        contextWindow,
        defaultParams,
        paramsStop,
      }),
    [
      t,
      assembleChatRag,
      handleStreamError,
      initiateStreaming,
      contextWindow,
      defaultParams,
      paramsStop,
    ]
  );

  return {
    sendMessage: (input, images, files) => service.sendMessage({ input, images, files }),
    editAndResend: (editedMessageId, newContent, images) =>
      service.editAndResend({ editedMessageId, newContent, images }),
  };
}
