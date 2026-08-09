import {
  type Message,
  type ModelParams,
  type ModelDefaultParams,
  VALIDATION_LIMITS,
} from '@musaed/contracts';
import { chatApi, conversationApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';
import toast from 'react-hot-toast';
import { useMessageStore } from '@/store/message-store';
import { useSettingsStore } from '@/store/settings-store';
import { useModelStore } from '@/store/model-store';
import { useConversationStore } from '@/store/conversation-store';
import { selectResolvedParams } from '@/store/model-params-store';
import { stopStream } from '@/store/coordination';

import { persistUserMessage } from '@/features/conversation/utils/message-persistence';
import type { FileAttachment } from '@/features/conversation/hooks/useAttachmentUtils';
import type { ChatRagSource } from '@/features/conversation/hooks/useChatRag';

/** Translation function shape from the i18n layer. */
type TranslationFn = (key: string, values?: Record<string, string | number | boolean>) => string;

/** Callback signature for RAG context assembly (injected from useChatRag hook). */
type AssembleChatRag = (query: string) => Promise<{ ragSources?: ChatRagSource[] }>;

/** Callback signature for stream error handling (injected from useChatStream hook). */
type HandleStreamError = (
  err: unknown,
  conversationId: string,
  requestId: string,
  updateLastMessage: (id: string, update: Partial<Message>, replace: boolean) => void,
  t: TranslationFn
) => void;

/** Callback signature for stream initiation (injected from useConversationActions). */
type InitiateStreaming = (conversationId: string, requestId: string) => void;

/** Dependencies injected into ChatSendService. All store access is via
 *  `.getState()` so the service reads fresh values at call time — no stale
 *  closures. React hooks (useChatRag, useChatStream) contribute their
 *  capabilities as plain function injections. */
export interface ChatSendServiceDeps {
  /** Translation function for user-visible toasts and error messages. */
  t: TranslationFn;
  /** Resolve RAG context for a query; best-effort (failures are swallowed). */
  assembleChatRag: AssembleChatRag;
  /** Handle a stream error: flush buffer, mark message, show toast. */
  handleStreamError: HandleStreamError;
  /** Register a new stream in the coordination layer. */
  initiateStreaming: InitiateStreaming;
  /** Per-model context window size (from Ollama `/api/show`). */
  contextWindow: number | null;
  /** Per-model sampling defaults from the Modelfile's PARAMETER directives. */
  defaultParams: ModelDefaultParams | null;
  /** Stop tokens from global settings. */
  paramsStop: string[];
}

/** Parameters for `ChatSendService.sendMessage`. */
export interface SendMessageParams {
  /** Raw user input text (will be trimmed). */
  input: string;
  /** Base64-encoded images attached to the message. */
  images?: string[];
  /** Text files attached to the message (content injected into the prompt). */
  files?: FileAttachment[];
}

/** Parameters for `ChatSendService.editAndResend`. */
export interface EditAndResendParams {
  /** ID of the user message being edited. */
  editedMessageId: string;
  /** New content for the edited message. */
  newContent: string;
  /** Images to attach to the edited message. */
  images?: string[];
}

/** Build prompt with file context injected. */
function buildPromptWithContext(input: string, files: FileAttachment[], t: TranslationFn): string {
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

/** Persist a message to the Rust backend. Errors are logged but non-fatal. */
async function persistMessage(conversationId: string, message: Message) {
  try {
    await persistUserMessage(conversationId, message);
  } catch (err) {
    logger.error('Failed to persist assistant message', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Resolve the Ollama base URL from global settings, with a safe default. */
function resolveOllamaUrl(globalSettings: { ollamaUrl?: string } | undefined): string {
  return globalSettings?.ollamaUrl || 'http://localhost:11434';
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
 * Send pipeline for the chat feature. Owns the full send lifecycle:
 * validation → message creation → RAG context → persist → chatApi.chat →
 * persist assistant message → error handling.
 *
 * This service is framework-agnostic — it holds no React references and
 * reads all store state via `.getState()` at call time, so it always sees
 * fresh values without re-subscribing. The `useChatSend` hook constructs
 * it per-render and delegates to it.
 */
export class ChatSendService {
  constructor(private readonly deps: ChatSendServiceDeps) {}

  /**
   * Send a new chat message.
   *
   * Validates preconditions, assembles RAG context, creates user + assistant
   * message objects, persists the user message, then calls `chatApi.chat`
   * to start the stream. On pre-stream failure, cleans up the orphaned
   * stream entry via `stopStream('batch-end')`.
   */
  async sendMessage(params: SendMessageParams): Promise<void> {
    const { t, assembleChatRag, handleStreamError, initiateStreaming } = this.deps;
    const { input, images = [], files = [] } = params;

    const messageStore = useMessageStore.getState();
    const conversationState = useConversationStore.getState();
    const settingsState = useSettingsStore.getState();
    const modelState = useModelStore.getState();

    const currentConversationId = conversationState.currentConversationId;
    const conversations = conversationState.conversations;
    const selectedModel = modelState.selectedModel;

    const trimmedInput = input.trim();
    const hasAttachments = images.length > 0 || files.length > 0;

    if (!currentConversationId || !selectedModel) {
      if (!selectedModel) toast.error(t('chat.noModelSelected'));
      return;
    }
    if (!trimmedInput && !hasAttachments) return;
    if (!conversations[currentConversationId]) return;

    const ollamaUrl = resolveOllamaUrl(settingsState.globalSettings);
    const fullPrompt = buildPromptWithContext(trimmedInput, files, t);

    if (fullPrompt.length > VALIDATION_LIMITS.MAX_MESSAGE_CONTENT_LEN) {
      toast.error(
        t('chat.messageTooLong', {
          limit: Math.round(VALIDATION_LIMITS.MAX_MESSAGE_CONTENT_LEN / 1024),
        })
      );
      return;
    }

    const requestId = crypto.randomUUID();
    initiateStreaming(currentConversationId, requestId);

    try {
      const { ragSources } = await assembleChatRag(trimmedInput);

      const [userMsg, assistantMsg] = createChatMessages(
        trimmedInput,
        images,
        selectedModel,
        requestId,
        ragSources
      );

      messageStore.addMessages(currentConversationId, [userMsg, assistantMsg]);
      persistMessage(currentConversationId, userMsg);

      await this.executeChatSendAttempt({
        conversationId: currentConversationId,
        requestId,
        ollamaUrl,
        fullPrompt,
        selectedModel,
        messages: messageStore.messages,
        t,
        handleStreamError,
      });
    } catch (err) {
      stopStream(currentConversationId, 'batch-end', requestId);
      logger.error('Chat send failed before stream start', {
        error: err instanceof Error ? err.message : String(err),
        conversationId: currentConversationId,
        requestId,
      });
    }
  }

  /**
   * Inline-edit a user message and re-stream: update the user message
   * in-place, delete the old assistant response from UI and backend,
   * append a fresh assistant placeholder, then call `chatApi.chat`.
   */
  async editAndResend(params: EditAndResendParams): Promise<void> {
    const { t, assembleChatRag, handleStreamError, initiateStreaming } = this.deps;
    const { editedMessageId, newContent, images = [] } = params;

    const messageStore = useMessageStore.getState();
    const conversationState = useConversationStore.getState();
    const settingsState = useSettingsStore.getState();
    const modelState = useModelStore.getState();

    const currentConversationId = conversationState.currentConversationId;
    const selectedModel = modelState.selectedModel;

    if (!currentConversationId || !selectedModel) return;

    const trimmedInput = newContent.trim();
    if (!trimmedInput && images.length === 0) return;

    const ollamaUrl = resolveOllamaUrl(settingsState.globalSettings);
    const fullPrompt = buildPromptWithContext(trimmedInput, [], t);

    const requestId = crypto.randomUUID();
    initiateStreaming(currentConversationId, requestId);

    try {
      const { ragSources } = await assembleChatRag(trimmedInput);

      const editedMsg = (messageStore.messages[currentConversationId] ?? []).find(
        (m) => m.id === editedMessageId
      );
      if (!editedMsg || editedMsg.role !== 'user') return;

      messageStore.updateMessage(currentConversationId, editedMessageId, {
        content: trimmedInput,
        images: images.length > 0 ? images : undefined,
      });
      persistMessage(currentConversationId, {
        ...editedMsg,
        content: trimmedInput,
        images: images.length > 0 ? images : undefined,
      });

      const msgs = messageStore.messages[currentConversationId] ?? [];
      const editedIdx = msgs.findIndex((m) => m.id === editedMessageId);
      if (editedIdx !== -1) {
        const nextAssistant = msgs.slice(editedIdx + 1).find((m) => m.role === 'assistant');
        if (nextAssistant) {
          messageStore.removeMessage(currentConversationId, nextAssistant.id);
          conversationApi.deleteMessage(currentConversationId, nextAssistant.id).catch((err) => {
            logger.error('Failed to delete old assistant message from backend', {
              error: err instanceof Error ? err.message : String(err),
              conversationId: currentConversationId,
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
      messageStore.addMessage(currentConversationId, assistantMsg);

      await this.executeChatSendAttempt({
        conversationId: currentConversationId,
        requestId,
        ollamaUrl,
        fullPrompt,
        selectedModel,
        messages: messageStore.messages,
        t,
        handleStreamError,
      });
    } catch (err) {
      stopStream(currentConversationId, 'batch-end', requestId);
      logger.error('Edit and resend failed before stream start', {
        error: err instanceof Error ? err.message : String(err),
        conversationId: currentConversationId,
        requestId,
      });
    }
  }

  /** Execute the chat API call and persist the assistant message on success. */
  private async executeChatSendAttempt(params: {
    conversationId: string;
    requestId: string;
    ollamaUrl: string;
    fullPrompt: string;
    selectedModel: string;
    messages: Record<string, Message[]>;
    t: TranslationFn;
    handleStreamError: HandleStreamError;
  }): Promise<void> {
    const { conversationId, requestId, ollamaUrl, fullPrompt, selectedModel, messages, t } = params;

    try {
      const resolved = selectResolvedParams(
        selectedModel,
        this.deps.contextWindow,
        this.deps.defaultParams
      );
      const payload = buildChatPayload(
        ollamaUrl,
        fullPrompt,
        selectedModel,
        requestId,
        resolved,
        this.deps.paramsStop
      );
      const success = await chatApi.chat(payload);
      if (success !== true) throw new Error(t('chat.connectionFailed'));

      const convMessages = messages[conversationId] || [];
      const assistantMsg = convMessages.find(
        (msg) => msg.role === 'assistant' && msg.requestId === requestId
      );
      if (assistantMsg) {
        await persistMessage(conversationId, assistantMsg);
      }
    } catch (err) {
      params.handleStreamError(
        err,
        conversationId,
        requestId,
        (id, update, replace) => useMessageStore.getState().updateLastMessage(id, update, replace),
        t
      );
    }
  }
}
