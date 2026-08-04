'use client';

import { useCallback } from 'react';
import { type Message, type ChatSettings, VALIDATION_LIMITS } from '@musaed/contracts';
import { useTranslation } from '@/lib/i18n';
import { chatApi } from '@/lib/ipc';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import toast from 'react-hot-toast';
import { useConversationActions } from './useConversationActions';
import { type FileAttachment } from './useAttachmentUtils';
import { useMessageStore } from '@/store/message-store';
import { useCurrentConversationId, useConversations } from '@/store/conversation-store';
import { useSettingsStore } from '@/store/settings-store';
import { useModelStore } from '@/store/model-store';
import { persistUserMessage } from '@/features/conversation/utils/message-persistence';
import { useChatRag, type ChatRagSource } from './useChatRag';
import { useChatStream } from './useChatStream';

/** Build prompt with file context injected. */
function buildPromptWithContext(
  input: string,
  files: FileAttachment[],
  t: (key: string, values?: Record<string, string | number | boolean>) => string
): string {
  if (files.length === 0) return input;
  const fileContext = files
    .map((f) => `${t('chat.fileLabel', { name: f.name })}\n${t('chat.contentLabel')}\n${f.content}`)
    .join('\n\n---\n\n');
  return `${input}\n\n${t('chat.fileContextLabel')}\n${fileContext}`;
}

/** Create user and assistant message objects for a new chat turn. */
function createChatMessages(
  input: string,
  images: string[],
  model: string,
  requestId: string,
  ragSources?: ChatRagSource[]
): [Message, Message] {
  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: 'user',
    content: input,
    images: images.length > 0 ? images : undefined,
    timestamp: Date.now(),
    requestId,
  };
  const assistantMsg: Message = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    model,
    requestId,
    ragSources,
  };
  return [userMsg, assistantMsg];
}

/** Persist a message to the Rust backend with retry logic. */
async function persistMessage(conversationId: string, message: Message) {
  try {
    await persistUserMessage(conversationId, message);
  } catch (err) {
    logger.error('Failed to persist assistant message', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Validate preconditions for sending a message. Returns true if OK. */
function validateSendMessage(
  currentConversationId: string | null,
  selectedModel: string | undefined,
  trimmedInput: string,
  hasAttachments: boolean,
  conversations: Record<string, unknown>,
  t: (key: string) => string
): boolean {
  if (!currentConversationId || !selectedModel) {
    if (!selectedModel) toast.error(t('chat.noModelSelected'));
    return false;
  }
  if (!trimmedInput && !hasAttachments) return false;
  if (!conversations[currentConversationId]) return false;
  return true;
}

/** Find and persist the assistant message for a given request. */
async function persistAssistantMessage(
  conversationId: string,
  requestId: string,
  messages: Message[]
) {
  const assistantMsg = messages.find(
    (msg: Message) => msg.role === 'assistant' && msg.requestId === requestId
  );
  if (assistantMsg) {
    await persistMessage(conversationId, assistantMsg);
  }
}

/** Build the chat API payload. */
function buildChatPayload(
  ollamaUrl: string,
  fullPrompt: string,
  selectedModel: string,
  requestId: string,
  settings: ChatSettings
) {
  return {
    baseUrl: ollamaUrl,
    messages: [{ role: 'user', content: fullPrompt }],
    options: {
      temperature: settings.temperature,
      stop: settings.stop,
      topK: settings.topK,
      topP: settings.topP,
      numPredict: settings.numPredict,
      numCtx: settings.numCtx,
    },
    model: selectedModel,
    requestId,
  };
}

/**
 * Send pipeline for the chat feature. Extracted from the former God hook
 * (audit F4). Owns: validation → message creation → RAG context →
 * persist → chatApi.chat → persist assistant message → error handling.
 *
 * Composes `useChatRag` (RAG context assembly) and `useChatStream` (stream
 * error handling).
 */
export function useChatSend(): {
  sendMessage: (input: string, images?: string[], files?: FileAttachment[]) => Promise<void>;
} {
  const settingsStore = useSettingsStore();
  const language = settingsStore.globalSettings?.language || 'en';
  const { t } = useTranslation(language);
  const { initiateStreaming } = useConversationActions();
  const messageStore = useMessageStore();
  const currentConversationId = useCurrentConversationId();
  const conversations = useConversations();
  const modelStore = useModelStore();
  const { assembleChatRag } = useChatRag();
  const { handleStreamError } = useChatStream();

  const sendMessage = useCallback(
    async (input: string, images: string[] = [], files: FileAttachment[] = []) => {
      const trimmedInput = input.trim();
      const hasAttachments = images.length > 0 || files.length > 0;

      const selectedModel = modelStore.selectedModel;
      const globalSettings =
        settingsStore.globalSettings ||
        ({ language: 'en', ollamaUrl: 'http://localhost:11434' } as const);
      const ollamaUrl: string = globalSettings.ollamaUrl || 'http://localhost:11434';

      if (!config.isTest) {
        if (
          !validateSendMessage(
            currentConversationId,
            selectedModel,
            trimmedInput,
            hasAttachments,
            conversations,
            t
          )
        )
          return;
      }

      const conversationId = currentConversationId || 'test-conversation-id';
      const fullPrompt = buildPromptWithContext(trimmedInput, files, t);

      if (!config.isTest && fullPrompt.length > VALIDATION_LIMITS.MAX_MESSAGE_CONTENT_LEN) {
        toast.error(
          t('chat.messageTooLong', {
            limit: Math.round(VALIDATION_LIMITS.MAX_MESSAGE_CONTENT_LEN / 1024),
          })
        );
        return;
      }

      const requestId = crypto.randomUUID();
      initiateStreaming(conversationId, requestId);

      const { ragSources } = await assembleChatRag(trimmedInput);

      const [userMsg, assistantMsg] = createChatMessages(
        trimmedInput,
        images,
        selectedModel,
        requestId,
        ragSources
      );

      messageStore.addMessages(conversationId, [userMsg, assistantMsg]);
      persistMessage(conversationId, userMsg);

      try {
        const payload = buildChatPayload(
          ollamaUrl,
          fullPrompt,
          selectedModel,
          requestId,
          globalSettings
        );
        const success = await chatApi.chat(payload);
        if (success !== true) throw new Error(t('chat.connectionFailed'));

        const messages = messageStore.messages[conversationId] || [];
        await persistAssistantMessage(conversationId, requestId, messages);
      } catch (err) {
        handleStreamError(
          err,
          conversationId,
          requestId,
          (id, update, replace) => messageStore.updateLastMessage(id, update, replace),
          t
        );
      }
    },
    [
      t,
      initiateStreaming,
      messageStore,
      currentConversationId,
      conversations,
      settingsStore.globalSettings,
      modelStore.selectedModel,
      assembleChatRag,
      handleStreamError,
    ]
  );

  return { sendMessage };
}
