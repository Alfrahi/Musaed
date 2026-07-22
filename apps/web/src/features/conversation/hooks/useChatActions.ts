'use client';

import { useCallback } from 'react';
import { type Message } from '@musaed/contracts';
import { useTranslation } from '@/lib/i18n';
import { chatApi, ragApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';
import { config } from '@/lib/config';
import toast from 'react-hot-toast';
import { flushAndStop } from '@/store/batch-manager';
import { useConversationActions } from './useConversationActions';
import { type FileAttachment } from './useAttachmentUtils';
import { useMessageStore } from '@/store/message-store';
import { useCurrentConversationId, useConversations } from '@/store/conversation-store';
import { useSettingsStore } from '@/store/settings-store';
import { useModelStore } from '@/store/model-store';
import { useRagStore } from '@/store/rag-store';
import { useSetUIError } from '@/store/ui-store';
import { persistUserMessage } from '@/features/conversation/utils/message-persistence';

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

/** Build RAG context for the chat query if an active project is set. */
async function fetchRagContext(
  query: string,
  activeRagProject: { id: string; path: string } | null,
  ollamaUrl: string
): Promise<
  | {
      context: string;
      sources: Array<{
        filePath: string;
        startLine: number;
        endLine: number;
        language: string | null;
      }>;
    }
  | undefined
> {
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
  requestId: string
) {
  return {
    baseUrl: ollamaUrl,
    messages: [{ role: 'user', content: fullPrompt }],
    options: { temperature: 0.7, stop: [], topK: 40, topP: 0.9, numPredict: 100, numCtx: 2048 },
    model: selectedModel,
    requestId,
  };
}

/**
 * Sends a message to Ollama with proper error handling and streaming setup.
 */
export const useChatActions = () => {
  const settingsStore = useSettingsStore();
  const language = settingsStore.globalSettings?.language || 'en';
  const { t } = useTranslation(language);
  const setErrorMessage = useSetUIError();
  const { initiateStreaming, stopStreaming } = useConversationActions();
  const messageStore = useMessageStore();
  const currentConversationId = useCurrentConversationId();
  const conversations = useConversations();
  const modelStore = useModelStore();
  const ragStore = useRagStore();

  const sendMessage = useCallback(
    async (input: string, images: string[] = [], files: FileAttachment[] = []) => {
      const trimmedInput = input.trim();
      const hasAttachments = images.length > 0 || files.length > 0;

      const selectedModel = modelStore.selectedModel;
      const globalSettings =
        settingsStore.globalSettings ||
        ({ language: 'en', ollamaUrl: 'http://localhost:11434' } as const);
      const ollamaUrl: string = globalSettings.ollamaUrl || 'http://localhost:11434';
      const activeRagProjectId = ragStore.activeProjectId;
      const activeRagProject = activeRagProjectId ? ragStore.projects?.[activeRagProjectId] : null;

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
      const requestId = crypto.randomUUID();
      initiateStreaming(conversationId, requestId);

      const fullPrompt = buildPromptWithContext(trimmedInput, files, t);
      const ragResult = await fetchRagContext(trimmedInput, activeRagProject, ollamaUrl);
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

      messageStore.addMessages(conversationId, [userMsg, assistantMsg]);
      persistMessage(conversationId, userMsg);

      try {
        const payload = buildChatPayload(ollamaUrl, fullPrompt, selectedModel, requestId);
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
          stopStreaming,
          (msg) => setErrorMessage(msg),
          t
        );
      }
    },
    [
      t,
      initiateStreaming,
      stopStreaming,
      setErrorMessage,
      messageStore,
      currentConversationId,
      conversations,
      settingsStore.globalSettings,
      modelStore.selectedModel,
      ragStore.activeProjectId,
      ragStore.projects,
    ]
  );

  /**
   * Aborts the current active message streaming
   */
  const abortMessage = useCallback(() => {
    if (currentConversationId) {
      stopStreaming(currentConversationId);
    }
  }, [stopStreaming, currentConversationId]);

  return { sendMessage, abortMessage };
};
