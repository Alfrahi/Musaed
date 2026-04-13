"use client";

import { useCallback } from 'react';
import { z } from 'zod';
import { useConversationStore, useModelStore, useSettingsStore, useUIStore } from '../../../store';
import { Message } from '@musaed/contracts';
import { useTranslation } from '../../../lib/i18n';
import { invoke } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';
import toast from 'react-hot-toast';
import { useConversationActions } from './useConversationActions';
import { FileAttachment } from './useAttachmentManager';
import { toOllamaBase64Image } from '../imageAttachment';

/** Ollama / some vision stacks ignore images when `content` is empty; keep UI text empty but send a prompt to the API. */
function ollamaUserTextContent(content: string, hasImages: boolean, t: (key: string) => string): string {
  if (hasImages && !content.trim()) return t('chat.imageOnlyApiPrompt');
  return content;
}

export function useChatActions() {
  const { currentConversationId, conversations, addMessage, updateLastMessage } = useConversationStore();
  const { selectedModel } = useModelStore();
  const { globalSettings } = useSettingsStore();
  const { setError } = useUIStore();
  const { initiateStreaming, stopStreaming } = useConversationActions();
  const { t } = useTranslation(globalSettings.language);

  /**
   * Internal helper to build the contextual prompt including file contents
   */
  const buildPromptWithContext = (input: string, files: FileAttachment[]) => {
    if (files.length === 0) return input;

    const fileContext = files.map(f => 
      `${t('chat.fileLabel', { name: f.name })}\n${t('chat.contentLabel')}\n${f.content}`
    ).join('\n\n---\n\n');

    return `${input}\n\n${t('chat.fileContextLabel')}\n${fileContext}`;
  };

  const sendMessage = useCallback(async (
    input: string,
    images: string[],
    files: FileAttachment[] = []
  ) => {
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

    const fullPrompt = buildPromptWithContext(trimmedInput, files);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmedInput,
      images: images.length > 0 ? images : undefined,
      timestamp: Date.now(),
      requestId,
    };

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      model: selectedModel,
      requestId,
    };

    addMessage(currentConversationId, userMsg);
    addMessage(currentConversationId, assistantMsg);

    try {
      const { ollamaUrl, systemPrompt, ...params } = globalSettings;

      const success = await invoke('chat_with_ollama', {
        baseUrl: ollamaUrl,
        model: selectedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          ...currentConv.messages.map(m => ({
            role: m.role,
            content:
              m.role === 'user'
                ? ollamaUserTextContent(m.content ?? '', !!(m.images && m.images.length > 0), t)
                : m.content,
            images: m.images?.map(toOllamaBase64Image)
          })),
          {
            role: 'user',
            content: ollamaUserTextContent(fullPrompt, images.length > 0, t),
            images: images.length > 0 ? images.map(toOllamaBase64Image) : undefined
          }
        ],
        requestId,
        options: {
          temperature: params.temperature,
          num_predict: params.num_predict,
          num_ctx: params.num_ctx,
          top_k: params.top_k,
          top_p: params.top_p,
          stop: params.stop
        }
      }, z.boolean());

      if (success === null) throw new Error(t('chat.connectionFailed'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes('aborted')) {
        logger.error('Chat error', { error: msg, requestId });
        updateLastMessage(currentConversationId, { content: `\n\n[Error: ${msg}]`, done: true }, false);
        stopStreaming(currentConversationId);
        setError(msg);
      }
    }
  }, [
    currentConversationId,
    conversations,
    selectedModel,
    globalSettings,
    t,
    addMessage,
    updateLastMessage,
    initiateStreaming,
    stopStreaming,
    setError
  ]);

  return { sendMessage };
}