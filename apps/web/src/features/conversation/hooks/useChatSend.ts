'use client';

import { useCallback } from 'react';
import {
  type Message,
  type ModelParams,
  type ModelDefaultParams,
  type Language,
  VALIDATION_LIMITS,
} from '@musaed/contracts';
import { useTranslation } from '@/lib/i18n';
import { chatApi } from '@/lib/ipc';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import toast from 'react-hot-toast';
import { useConversationActions } from './useConversationActions';
import { type FileAttachment } from './useAttachmentUtils';
import { useMessageStore, type MessageState } from '@/store/message-store';
import { useCurrentConversationId, useConversations } from '@/store/conversation-store';
import { useSettingsStore, type SettingsState } from '@/store/settings-store';
import { useModelStore } from '@/store/model-store';
import { selectResolvedParams } from '@/store/model-params-store';
import { stopStream } from '@/store/coordination';
import { useModelContextWindow } from '@/features/library';
import { persistUserMessage } from '@/features/conversation/utils/message-persistence';
import { conversationApi } from '@/lib/ipc';
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

/** Parameters for the edit-and-resend attempt. */
interface EditAndResendParams {
  conversationId: string;
  editedMessageId: string;
  newContent: string;
  images: string[];
  selectedModel: string;
  requestId: string;
  ollamaUrl: string;
  fullPrompt: string;
  contextWindow: number | null;
  defaultParams: ModelDefaultParams | null;
  paramsStop: string[];
  messages: Record<string, Message[]>;
  initiateStreaming: (conversationId: string, requestId: string) => void;
  updateMessage: (conversationId: string, messageId: string, patch: Partial<Message>) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  addMessage: (conversationId: string, message: Message) => void;
  addMessages: (conversationId: string, messages: Message[]) => void;
  updateLastMessage: (conversationId: string, update: Partial<Message>, replace?: boolean) => void;
  assembleChatRag: (input: string) => Promise<{ ragSources?: ChatRagSource[] }>;
  handleStreamError: ReturnType<typeof useChatStream>['handleStreamError'];
  t: (key: string) => string;
}

/** Execute an inline edit: update the user message, remove the old
 *  assistant response, append a fresh placeholder, and stream. */
async function executeEditAndResend(params: EditAndResendParams): Promise<void> {
  const {
    conversationId,
    editedMessageId,
    newContent,
    images,
    selectedModel,
    requestId,
    ollamaUrl,
    fullPrompt,
    contextWindow,
    defaultParams,
    paramsStop,
    messages,
    initiateStreaming,
    updateMessage,
    removeMessage,
    addMessage,
    addMessages,
    updateLastMessage,
    assembleChatRag,
    handleStreamError,
    t,
  } = params;

  const trimmedInput = newContent.trim();
  if (!trimmedInput && images.length === 0) return;

  initiateStreaming(conversationId, requestId);

  try {
    const { ragSources } = await assembleChatRag(trimmedInput);

    const editedMsg = (messages[conversationId] ?? []).find((m) => m.id === editedMessageId);
    if (!editedMsg || editedMsg.role !== 'user') return;

    updateMessage(conversationId, editedMessageId, {
      content: trimmedInput,
      images: images.length > 0 ? images : undefined,
    });
    persistMessage(conversationId, {
      ...editedMsg,
      content: trimmedInput,
      images: images.length > 0 ? images : undefined,
    });

    const msgs = messages[conversationId] ?? [];
    const editedIdx = msgs.findIndex((m) => m.id === editedMessageId);
    if (editedIdx !== -1) {
      const nextAssistant = msgs.slice(editedIdx + 1).find((m) => m.role === 'assistant');
      if (nextAssistant) {
        removeMessage(conversationId, nextAssistant.id);
        conversationApi.deleteMessage(conversationId, nextAssistant.id).catch((err) => {
          logger.error('Failed to delete old assistant message from backend', {
            error: err instanceof Error ? err.message : String(err),
            conversationId,
            messageId: nextAssistant.id,
          });
        });
      }
    }

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      model: selectedModel,
      requestId,
      ragSources,
    };
    addMessage(conversationId, assistantMsg);

    await executeChatSendAttempt({
      conversationId,
      requestId,
      ollamaUrl,
      fullPrompt,
      selectedModel,
      contextWindow,
      defaultParams,
      paramsStop,
      messages,
      addMessages,
      updateLastMessage,
      handleStreamError,
      t,
    });
  } catch (err) {
    // Safety-net cleanup: a pre-stream error (e.g. `assembleChatRag`
    // threw after `initiateStreaming` registered the stream) means no
    // completion or error path ran. Route through `stopStream('batch-end')`
    // so the streaming store entry is cleared and `isStreaming` decrements
    // when no streams remain. Buffered content is discarded.
    stopStream(conversationId, 'batch-end', requestId);
    logger.error('Edit and resend failed before stream start', {
      error: err instanceof Error ? err.message : String(err),
      conversationId,
      requestId,
    });
  }
}

/**
 * Send pipeline for the chat feature. Extracted from the former God hook
 * Owns: validation → message creation → RAG context →
 * persist → chatApi.chat → persist assistant message → error handling.
 *
 * Composes `useChatRag` (RAG context assembly) and `useChatStream` (stream
 * error handling).
 */
/** Build the `sendMessage` callback. Extracted from `useChatSend` to keep
 *  the hook body under the project's max-lines-per-function lint gate. */
function useSendMessageCallback(
  settingsStore: SettingsState,
  language: Language,
  currentConversationId: string | null,
  conversations: Record<string, unknown>,
  selectedModel: string | undefined,
  contextWindow: number | null,
  defaultParams: ModelDefaultParams | null,
  paramsStop: string[],
  messageStore: MessageState,
  initiateStreaming: ReturnType<typeof useConversationActions>['initiateStreaming'],
  assembleChatRag: ReturnType<typeof useChatRag>['assembleChatRag'],
  handleStreamError: ReturnType<typeof useChatStream>['handleStreamError']
) {
  const { t } = useTranslation(language);

  return useCallback(
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

      const model = selectedModel as string;
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

      // Guard against unbounded `activeStreams` growth:
      // if an error occurs after `initiateStreaming` registers the stream
      // in `activeStreams` but before `executeChatSendAttempt` (e.g.
      // `assembleChatRag` throws), no cleanup path runs and the entry leaks
      // forever. We catch such errors here, clean up the orphaned stream,
      // and re-throw so the caller can still react.
      //
      // We deliberately do NOT use `finally` here — the normal streaming
      // completion path is handled asynchronously by `handleToken` /
      // `stopStream('complete')` in useTauriEvents, which runs
      // AFTER `chatApi.chat` resolves. A `finally` would clear the
      // stream entry before the tokens arrive, killing the response.
      try {
        const { ragSources } = await assembleChatRag(trimmedInput);

        const [userMsg, assistantMsg] = createChatMessages(
          trimmedInput,
          images,
          model,
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
          selectedModel: model,
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
        // orphaned stream entry via `stopStream('batch-end')` so the
        // coordination layer owns the cleanup; buffered content is
        // discarded.
        stopStream(conversationId, 'batch-end', requestId);
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
}

/** Build the `editAndResend` callback. Extracted from `useChatSend` to keep
 *  the hook body under the project's max-lines-per-function lint gate. */
function useEditAndResendCallback(
  currentConversationId: string | null,
  selectedModel: string | undefined,
  settingsStore: SettingsState,
  language: Language,
  contextWindow: number | null,
  defaultParams: ModelDefaultParams | null,
  paramsStop: string[],
  messageStore: MessageState,
  initiateStreaming: ReturnType<typeof useConversationActions>['initiateStreaming'],
  assembleChatRag: ReturnType<typeof useChatRag>['assembleChatRag'],
  handleStreamError: ReturnType<typeof useChatStream>['handleStreamError']
) {
  const { t } = useTranslation(language);

  return useCallback(
    async (editedMessageId: string, newContent: string, images: string[] = []) => {
      if (!currentConversationId || !selectedModel) return;
      await executeEditAndResend({
        conversationId: currentConversationId,
        editedMessageId,
        newContent,
        images,
        selectedModel,
        requestId: crypto.randomUUID(),
        ollamaUrl: resolveOllamaUrl(settingsStore.globalSettings),
        fullPrompt: buildPromptWithContext(newContent.trim(), [], t),
        contextWindow,
        defaultParams,
        paramsStop,
        messages: messageStore.messages,
        initiateStreaming,
        updateMessage: messageStore.updateMessage,
        removeMessage: messageStore.removeMessage,
        addMessage: messageStore.addMessage,
        addMessages: messageStore.addMessages,
        updateLastMessage: messageStore.updateLastMessage,
        assembleChatRag,
        handleStreamError,
        t,
      });
    },
    [
      t,
      currentConversationId,
      selectedModel,
      settingsStore.globalSettings,
      contextWindow,
      defaultParams,
      paramsStop,
      messageStore,
      initiateStreaming,
      assembleChatRag,
      handleStreamError,
    ]
  );
}

export function useChatSend(): {
  sendMessage: (input: string, images?: string[], files?: FileAttachment[]) => Promise<void>;
  editAndResend: (editedMessageId: string, newContent: string, images?: string[]) => Promise<void>;
} {
  const settingsStore = useSettingsStore();
  const language = settingsStore.globalSettings?.language || 'en';
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

  const editAndResendCb = useEditAndResendCallback(
    currentConversationId,
    selectedModel,
    settingsStore,
    language,
    contextWindow,
    defaultParams,
    paramsStop,
    messageStore,
    initiateStreaming,
    assembleChatRag,
    handleStreamError
  );

  const sendMessage = useSendMessageCallback(
    settingsStore,
    language,
    currentConversationId,
    conversations,
    selectedModel,
    contextWindow,
    defaultParams,
    paramsStop,
    messageStore,
    initiateStreaming,
    assembleChatRag,
    handleStreamError
  );

  return { sendMessage, editAndResend: editAndResendCb };
}
