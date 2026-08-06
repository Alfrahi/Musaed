'use client';

import { useCallback } from 'react';
import {
  type Message,
  type ModelParams,
  type ModelDefaultParams,
  VALIDATION_LIMITS,
} from '@musaed/contracts';
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
import { selectResolvedParams } from '@/store/model-params-store';
import { useStreamingStore } from '@/store/streaming-store';
import { useUIStore } from '@/store/ui-store';
import { useModelContextWindow } from '@/features/library';
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
  params: ModelParams,
  stop: string[]
) {
  return {
    baseUrl: ollamaUrl,
    messages: [{ role: 'user', content: fullPrompt }],
    options: {
      temperature: params.temperature,
      stop,
      topK: params.topK,
      topP: params.topP,
      numPredict: params.numPredict,
      numCtx: params.numCtx,
    },
    model: selectedModel,
    requestId,
  };
}

/**
 * Safety-net cleanup for orphaned `activeStreams` entries (audit bug 1.8).
 * If a stream entry is still registered for `conversationId` with the
 * given `requestId` at this point, no completion or error path cleaned it
 * up (e.g. `assembleChatRag` threw before the inner try/catch). Removes
 * the entry to prevent a memory leak and orphaned streaming state.
 */
function cleanupOrphanedStream(conversationId: string, requestId: string): void {
  const { activeStreams } = useStreamingStore.getState();
  if (activeStreams[conversationId] !== requestId) return;
  useStreamingStore.getState().stopStream(conversationId);
  useStreamingStore.getState().clearStream(conversationId);
  if (Object.keys(useStreamingStore.getState().activeStreams).length === 0) {
    useUIStore.getState().setStreaming(false);
  }
}

/** Resolve the Ollama base URL from global settings, with a safe default. */
function resolveOllamaUrl(globalSettings: { ollamaUrl?: string } | undefined): string {
  return globalSettings?.ollamaUrl || 'http://localhost:11434';
}

/** Parameters for the chat send attempt. */
interface ChatSendAttemptParams {
  conversationId: string;
  requestId: string;
  ollamaUrl: string;
  fullPrompt: string;
  selectedModel: string;
  contextWindow: number | null;
  defaultParams: ModelDefaultParams | null;
  paramsStop: string[];
  messages: Record<string, Message[]>;
  addMessages: (conversationId: string, messages: Message[]) => void;
  updateLastMessage: (conversationId: string, update: Partial<Message>, replace?: boolean) => void;
  handleStreamError: ReturnType<typeof useChatStream>['handleStreamError'];
  t: (key: string) => string;
}

/** Execute the chat API call and persist the assistant message on success. */
async function executeChatSendAttempt(params: ChatSendAttemptParams): Promise<void> {
  const {
    conversationId,
    requestId,
    ollamaUrl,
    fullPrompt,
    selectedModel,
    contextWindow,
    defaultParams,
    paramsStop,
    messages,
    handleStreamError,
    t,
  } = params;

  try {
    const resolved = selectResolvedParams(selectedModel, contextWindow, defaultParams);
    const payload = buildChatPayload(
      ollamaUrl,
      fullPrompt,
      selectedModel,
      requestId,
      resolved,
      paramsStop
    );
    const success = await chatApi.chat(payload);
    if (success !== true) throw new Error(t('chat.connectionFailed'));

    const convMessages = messages[conversationId] || [];
    await persistAssistantMessage(conversationId, requestId, convMessages);
  } catch (err) {
    handleStreamError(
      err,
      conversationId,
      requestId,
      (id, update, replace) => params.updateLastMessage(id, update, replace),
      t
    );
  }
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

  // Per-model sampling params: resolved from model-params store with the
  // model's context_length and Modelfile `PARAMETER` defaults as the
  // fallback when not overridden.
  const selectedModel = modelStore.selectedModel;
  const { contextWindow, defaultParams } = useModelContextWindow();
  const paramsStop = useSettingsStore((s) => s.globalSettings.stop);
  // `selectResolvedParams` is intentionally a getState-based snapshot for the
  // non-react send path; we read it inside the callback so the latest override
  // is used at send time without re-subscribing this hook to every keystroke.

  const sendMessage = useCallback(
    async (input: string, images: string[] = [], files: FileAttachment[] = []) => {
      const trimmedInput = input.trim();
      const hasAttachments = images.length > 0 || files.length > 0;

      const ollamaUrl: string = resolveOllamaUrl(settingsStore.globalSettings);

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

      // Guard against unbounded `activeStreams` growth (audit bug 1.8):
      // if an error occurs after `initiateStreaming` registers the stream
      // in `activeStreams` but before `executeChatSendAttempt` (e.g.
      // `assembleChatRag` throws), no cleanup path runs and the entry leaks
      // forever. We catch such errors here, clean up the orphaned stream,
      // and re-throw so the caller can still react.
      //
      // We deliberately do NOT use `finally` here — the normal streaming
      // completion path is handled asynchronously by `handleToken` /
      // `completeStreamForConversation` in useTauriEvents, which runs
      // AFTER `chatApi.chat` resolves. A `finally` would clear the
      // stream entry before the tokens arrive, killing the response.
      try {
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

        await executeChatSendAttempt({
          conversationId,
          requestId,
          ollamaUrl,
          fullPrompt,
          selectedModel,
          contextWindow,
          defaultParams,
          paramsStop,
          messages: messageStore.messages,
          addMessages: messageStore.addMessages,
          updateLastMessage: messageStore.updateLastMessage,
          handleStreamError,
          t,
        });
      } catch (err) {
        // `executeChatSendAttempt` has its own catch that calls
        // `handleStreamError` — if we get here the error happened before
        // that inner try (e.g. `assembleChatRag` threw). Clean up the
        // orphaned stream entry to prevent a memory leak.
        cleanupOrphanedStream(conversationId, requestId);
        logger.error('Chat send failed before stream start', {
          error: err instanceof Error ? err.message : String(err),
          conversationId,
          requestId,
        });
      }
    },
    [
      t,
      initiateStreaming,
      messageStore,
      currentConversationId,
      conversations,
      settingsStore.globalSettings,
      selectedModel,
      assembleChatRag,
      handleStreamError,
      contextWindow,
      defaultParams,
      paramsStop,
    ]
  );

  return { sendMessage };
}
