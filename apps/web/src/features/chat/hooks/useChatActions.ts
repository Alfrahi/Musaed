'use client';

import { useCallback } from 'react';
import {
  useCurrentConversationId,
  useConversations,
  useAddMessages,
  useUpdateLastMessage,
  useSelectedModel,
  useGlobalSettings,
  useSetUIError,
  useActiveRagProject,
} from '../../../store/hooks';
import { Message } from '@musaed/contracts';
import { useTranslation } from '../../../lib/i18n';
import { chatApi, ragApi } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';
import toast from 'react-hot-toast';
import { flushAndStop } from '../../../store/batch-manager';
import { useConversationActions } from './useConversationActions';
import { FileAttachment } from './useAttachmentUtils';
import { buildRagSystemContext } from '@/features/rag';

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
function getUserMessageContent(
  content: string,
  hasImages: boolean,
  t: (key: string) => string
): string {
  return hasImages && !content.trim() ? t('chat.imageOnlyApiPrompt') : content;
}

/** Build the messages array for the Ollama API request. */
const buildApiMessages = (
  currentConv: { messages: Message[] },
  fullPrompt: string,
  images: string[],
  t: (key: string, values?: Record<string, string | number | boolean>) => string,
  systemPrompt: string,
  ragContext?: string
) => {
  // Merge RAG context with user's system prompt
  let combinedSystem = systemPrompt;
  if (ragContext) {
    combinedSystem = combinedSystem ? `${ragContext}\n\n${combinedSystem}` : ragContext;
  }

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

  // Only add system message if there's actual content
  if (combinedSystem) {
    messages.push({ role: 'system', content: combinedSystem });
  }

  messages.push(
    ...currentConv.messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content:
        m.role === 'user'
          ? getUserMessageContent(m.content ?? '', !!m.images?.length, t)
          : m.content,
    }))
  );
  messages.push({ role: 'user', content: getUserMessageContent(fullPrompt, images.length > 0, t) });

  return messages;
};

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
  setError(msg);
  toast.error(msg);
};

interface RagSourceRef {
  filePath: string;
  startLine: number;
  endLine: number;
  language?: string;
}

/** Build RAG context for the chat query if an active project is set. */
async function fetchRagContext(
  query: string,
  activeRagProject: { id: string; path: string } | null,
  ollamaUrl: string
): Promise<{ context: string; sources: RagSourceRef[] } | undefined> {
  if (!activeRagProject) return undefined;
  try {
    const results = await ragApi.search({
      projectId: activeRagProject.id,
      query,
      topK: 10,
      baseUrl: ollamaUrl,
    });
    if (results && results.length > 0) {
      const context = buildRagSystemContext(results, activeRagProject.path);
      const sources: RagSourceRef[] = results.map((r) => ({
        filePath: r.filePath,
        startLine: r.startLine,
        endLine: r.endLine,
        language: r.language ?? undefined,
      }));
      return { context, sources };
    }
  } catch (err) {
    logger.warn('RAG search failed, continuing without context:', { error: String(err) });
  }
  return undefined;
}

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
  const activeRagProject = useActiveRagProject();

  const { initiateStreaming, stopStreaming } = useConversationActions();
  const { t } = useTranslation(globalSettings.language);

  const sendMessage = useCallback(
    async (input: string, images: string[], files: FileAttachment[] = []) => {
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
      const ragResult = await fetchRagContext(
        trimmedInput,
        activeRagProject,
        globalSettings.ollamaUrl
      );
      const ragContext = ragResult?.context;
      const ragSources = ragResult?.sources;

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
        ragSources,
      };
      addMessages(currentConversationId, [userMsg, assistantMsg]);

      try {
        const { ollamaUrl, ...params } = globalSettings;
        const success = await chatApi.chat({
          baseUrl: ollamaUrl,
          model: selectedModel,
          messages: buildApiMessages(
            currentConv,
            fullPrompt,
            images,
            t,
            globalSettings.systemPrompt,
            ragContext
          ),
          requestId,
          options: {
            temperature: params.temperature,
            num_predict: params.num_predict,
            num_ctx: params.num_ctx,
            top_k: params.top_k,
            top_p: params.top_p,
            stop: params.stop,
          },
        });
        if (success !== true) throw new Error(t('chat.connectionFailed'));
      } catch (err) {
        handleStreamError(
          err,
          currentConversationId,
          requestId,
          updateLastMessage,
          stopStreaming,
          setError,
          t
        );
      }
    },
    [
      currentConversationId,
      conversations,
      selectedModel,
      globalSettings,
      t,
      addMessages,
      updateLastMessage,
      initiateStreaming,
      stopStreaming,
      setError,
      activeRagProject,
    ]
  );

  return { sendMessage };
};
