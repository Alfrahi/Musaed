'use client';

import { useCallback } from 'react';
import { type Message } from '@musaed/contracts';
import { useTranslation } from '../../../lib/i18n';
import { chatApi, ragApi } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';
import toast from 'react-hot-toast';
import { flushAndStop } from '../../../store/batch-manager';
import { useConversationActions } from './useConversationActions';
import { type FileAttachment } from './useAttachmentUtils';
import { useMessageStore } from '../store/message-store';
import type { Citation } from '@musaed/contracts';
import { persistMessage } from '../utils/message-persistence';
import { useConversationStore } from '../store/conversation-store';
import { useSettingsStore } from '../../settings/store/settings-store';
import { useModelStore } from '../../settings/store/model-store';
import { useRagStore } from '../../rag/store/rag-store';
import { useUIStore } from '../../../store/ui-store';

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

/** Get user message content, substituting for image-only messages. */
// getUserMessageContent and buildApiMessages removed – unused helper functions were previously defined but are no longer needed.

/** Handle streaming errors — log, update message, notify user. */
const handleStreamError = (
  err: unknown,
  conversationId: string,
  requestId: string,
  updateLastMessage: (id: string, update: Partial<Message>, replace: boolean) => void,
  stopStreaming: (id: string) => void,
  setError: (msg: string) => void,
  t: (key: string) => string
) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.toLowerCase().includes('aborted')) return;
  logger.error('Chat error', { error: msg, requestId });
  // Flush any buffered tokens before appending the error message
  flushAndStop(conversationId);
  updateLastMessage(
    conversationId,
    { content: `\n\n[${t('chat.errorPrefix')}: ${msg}]`, done: true },
    false
  );
  stopStreaming(conversationId);

  // Persist the failed assistant message to Rust backend with retry logic
  const msgs = useMessageStore.getState().messages[conversationId] ?? [];
  const lastMsg = msgs[msgs.length - 1];
  if (lastMsg && lastMsg.role === 'assistant') {
    persistMessage(conversationId, lastMsg).then((result) => {
      if (!result.success) {
        logger.error('Failed to persist error message after retries', {
          conversationId,
          messageId: lastMsg.id,
          retries: result.retries,
          error: result.error,
        });
      }
    });
  }

  setError(msg);
  toast.error(msg);
};

/** Build RAG context for the chat query if an active project is set. */
async function fetchRagContext(
  query: string,
  activeRagProject: { id: string; path: string } | null,
  ollamaUrl: string
): Promise<{ context: string; sources: Citation[] } | undefined> {
  if (!activeRagProject) return undefined;
  try {
    const result = await ragApi.assembleContext({
      projectId: activeRagProject.id,
      query,
      topK: 10,
      baseUrl: ollamaUrl,
    });
    if (result && result.assembledContext) {
      return { context: result.assembledContext, sources: result.citations };
    }
  } catch (err) {
    logger.warn('RAG context assembly failed, continuing without context:', { error: String(err) });
  }
  return undefined;
}

// prepareChatPayload removed – unused (function was not used)

/** Create user and assistant message objects for a new chat turn. */
function createChatMessages(
  input: string,
  images: string[],
  model: string,
  requestId: string,
  ragSources?: {
    filePath: string;
    startLine: number;
    endLine: number;
    language: string | undefined;
  }[]
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

/** Persist the user message to the Rust backend with retry logic. */
function persistUserMessage(conversationId: string, userMsg: Message) {
  persistMessage(conversationId, userMsg).then((result) => {
    if (!result.success) {
      logger.error('Failed to persist user message after retries', {
        conversationId,
        messageId: userMsg.id,
        retries: result.retries,
        error: result.error,
      });
    }
  });
}

/**
 * Sends a message to Ollama with proper error handling and streaming setup.
 */
export const useChatActions = () => {
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const { initiateStreaming, stopStreaming } = useConversationActions();

  const sendMessage = useCallback(
    async (input: string, images: string[], files: FileAttachment[] = []) => {
      const trimmedInput = input.trim();
      const hasAttachments = images.length > 0 || files.length > 0;

      const currentConversationId = useConversationStore.getState().currentConversationId;
      const selectedModel = useModelStore.getState().selectedModel;
      const conversations = useConversationStore.getState().conversations;
      const globalSettings = useSettingsStore.getState().globalSettings;
      const activeRagProjectId = useRagStore.getState().activeProjectId;
      const activeRagProject = activeRagProjectId
        ? useRagStore.getState().projects[activeRagProjectId]
        : null;

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
      const ragResult = await fetchRagContext(
        trimmedInput,
        activeRagProject,
        globalSettings.ollamaUrl
      );
      const ragSources = ragResult?.sources.map((s) => ({
        filePath: s.filePath,
        startLine: s.startLine,
        endLine: s.endLine,
        language: s.language ?? undefined,
      }));

      const [userMsg, assistantMsg] = createChatMessages(
        trimmedInput,
        images,
        selectedModel,
        requestId,
        ragSources
      );
      // Capture existing messages before adding the new ones for payload construction
      // const existingMessages = useMessageStore.getState().messages[currentConversationId] || []; // retained for potential future use
      // Add new messages to the store after capturing existing ones
      useMessageStore.getState().addMessages(currentConversationId, [userMsg, assistantMsg]);
      persistUserMessage(currentConversationId, userMsg);

      try {
        const payload = {
          baseUrl: globalSettings.ollamaUrl,
          messages: [{ role: 'user', content: fullPrompt }],
          options: {
            temperature: 0.7,
            stop: [],
            top_k: 40,
            top_p: 0.9,
            num_predict: 100,
            num_ctx: 2048,
          },
        };
        const success = await chatApi.chat({ ...payload, model: selectedModel, requestId });
        if (success !== true) throw new Error(t('chat.connectionFailed'));
      } catch (err) {
        const convId = useConversationStore.getState().currentConversationId;
        if (convId) {
          handleStreamError(
            err,
            convId,
            requestId,
            (id, update, replace) =>
              useMessageStore.getState().updateLastMessage(id, update, replace),
            stopStreaming,
            (msg) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (useUIStore as any).getState().setErrorMessage(msg);
            },
            t
          );
        }
      }
    },
    [t, initiateStreaming, stopStreaming]
  );

  return { sendMessage };
};
