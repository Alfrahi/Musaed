"use client";

import { useCallback } from 'react';
import { useCurrentConversationId, useConversations, useAddMessages, useUpdateLastMessage, useSelectedModel, useGlobalSettings, useSetUIError } from '../../../store/hooks';
import { Message } from '@musaed/contracts';
import { useTranslation } from '../../../lib/i18n';
import { chatApi } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';
import toast from 'react-hot-toast';
import { useConversationActions } from './useConversationActions';
import { FileAttachment } from './useAttachmentUtils';
import { toOllamaBase64Image } from '../imageAttachment';

/** Build prompt with file context injected. */
function buildPromptWithContext(input: string, files: FileAttachment[], t: (key: string, values?: Record<string, string | number | boolean>) => string): string {
  if (files.length === 0) return input;
  const fileContext = files.map(f =>
    `${t('chat.fileLabel', { name: f.name })}\n${t('chat.contentLabel')}\n${f.content}`
  ).join('\n\n---\n\n');
  return `${input}\n\n${t('chat.fileContextLabel')}\n${fileContext}`;
}

/** Get user message content, substituting for image-only messages. */
function getUserMessageContent(content: string, hasImages: boolean, t: (key: string) => string): string {
  return (hasImages && !content.trim()) ? t('chat.imageOnlyApiPrompt') : content;
}

/** Build the messages array for the Ollama API request. */
const buildApiMessages = (
  currentConv: { messages: Message[] },
  fullPrompt: string,
  images: string[],
  t: (key: string, values?: Record<string, string | number | boolean>) => string,
) => [
  { role: 'system' as const, content: '' },
  ...currentConv.messages.map(m => ({
    role: m.role,
    content: m.role === 'user' ? getUserMessageContent(m.content ?? '', !!(m.images?.length), t) : m.content,
  })),
  { role: 'user' as const, content: getUserMessageContent(fullPrompt, images.length > 0, t) },
];

/** Handle streaming errors — log, update message, notify user. */
const handleStreamError = (
  err: unknown,
  conversationId: string,
  requestId: string,
  updateLastMessage: (id: string, update: Partial<Message>, replace: boolean) => void,
  stopStreaming: (id: string) => void,
  setError: (msg: string) => void,
  t: (key: string) => string,
) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.toLowerCase().includes('aborted')) return;

  logger.error('Chat error', { error: msg, requestId });
  updateLastMessage(conversationId, { content: `\n\n[${t('chat.errorPrefix')}: ${msg}]`, done: true }, false);
  stopStreaming(conversationId);
  setError(msg);
  toast.error(msg);
};

/**
 * Sends a message to Ollama with proper error handling and streaming setup.
 */
export const useChatActions = () => {
  const currentConversationId = useCurrentConversationId();
  const conversations = useConversations();
  const addMessages = useAddMessages();
  const updateLastMessage = useUpdateLastMessage();
  const selectedModel = useSelectedModel();
  const globalSettings = useGlobalSettings();
  const setError = useSetUIError();

  const { initiateStreaming, stopStreaming } = useConversationActions();
  const { t } = useTranslation(globalSettings.language);

  const sendMessage = useCallback(async (input: string, images: string[], files: FileAttachment[] = []) => {
    const trimmedInput = input.trim();
    const hasAttachments = images.length > 0 || files.length > 0;

    if (!currentConversationId || !selectedModel) {
      if (!selectedModel) toast.error(t('chat.noModelSelected'));
      return;
    }
    if (!trimmedInput && !hasAttachments) return;

    const currentConv = conversations[currentConversationId];
    if (!currentConv) return;

    const requestId = crypto.randomUUID();
    initiateStreaming(currentConversationId, requestId);

    const fullPrompt = buildPromptWithContext(trimmedInput, files, t);

    const userMsg: Message = {
      id: crypto.randomUUID(), role: 'user', content: trimmedInput,
      images: images.length > 0 ? images : undefined, timestamp: Date.now(), requestId,
    };
    const assistantMsg: Message = {
      id: crypto.randomUUID(), role: 'assistant', content: '',
      timestamp: Date.now(), model: selectedModel, requestId,
    };
    addMessages(currentConversationId, [userMsg, assistantMsg]);

    try {
      const { ollamaUrl, systemPrompt, ...params } = globalSettings;
      const success = await chatApi.chat({
        baseUrl: ollamaUrl,
        model: selectedModel,
        messages: buildApiMessages(currentConv, fullPrompt, images, t),
        requestId,
        options: {
          temperature: params.temperature, num_predict: params.num_predict,
          num_ctx: params.num_ctx, top_k: params.top_k, top_p: params.top_p, stop: params.stop,
        },
      });
      if (success !== true) throw new Error(t('chat.connectionFailed'));
    } catch (err) {
      handleStreamError(err, currentConversationId, requestId, updateLastMessage, stopStreaming, setError, t);
    }
  }, [currentConversationId, conversations, selectedModel, globalSettings, t, addMessages, updateLastMessage, initiateStreaming, stopStreaming, setError]);

  return { sendMessage };
};
