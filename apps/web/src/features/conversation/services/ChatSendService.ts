import {
  type Message,
  type ChatMessage,
  type ModelParams,
  type ModelDefaultParams,
  VALIDATION_LIMITS,
  RAG_VALIDATION_LIMITS,
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
type AssembleChatRag = (
  query: string,
  maxChars?: number
) => Promise<{
  ragSources?: ChatRagSource[];
  assembledContext?: string;
  ragTokenCount?: number;
}>;

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

/**
 * Build a token-budgeted slice of prior conversation messages to send as
 * context. Walks backwards from the latest message, accumulating token
 * estimates via a reversed `promptEvalCount` walk, and stops when the
 * cumulative budget is exhausted.
 *
 * Only messages with role `user` or `assistant` and non-empty content are
 * included — error bubbles, stopped placeholders, and system messages are
 * filtered out. The returned slice is in chronological order.
 *
 * The last user message in the slice is the *current* user message and is
 * excluded from the history (it's appended separately as the final element
 * in the payload).
 */
function buildMessageHistory(
  convMessages: Message[],
  currentRequestId: string,
  numCtx: number,
  reserves: { systemPrompt: number; ragContext: number; currentPrompt: number }
): ChatMessage[] {
  const totalReserve = reserves.systemPrompt + reserves.ragContext + reserves.currentPrompt;
  const budget = Math.max(0, numCtx - totalReserve);
  if (budget <= 0 || convMessages.length === 0) return [];

  // Walk backwards, skipping the placeholder assistant for the current
  // request and the current user message itself (both share currentRequestId).
  const history: ChatMessage[] = [];
  let estimatedTokens = 0;

  for (let i = convMessages.length - 1; i >= 0; i--) {
    const msg = convMessages[i];

    // Skip the current turn's messages (they go in the payload separately).
    if (msg.requestId === currentRequestId) continue;

    // Only include user/assistant messages with non-empty content.
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    if (!msg.content || msg.content.length === 0) continue;
    // Skip error/stopped placeholders.
    if (msg.error || msg.stopped) continue;

    // Rough token estimate: ~4 chars per token. Use promptEvalCount from
    // the assistant message if available for a more accurate cumulative check.
    const msgTokens = msg.promptEvalCount ?? Math.ceil(msg.content.length / 4);

    if (estimatedTokens + msgTokens > budget) break;

    history.unshift({ role: msg.role, content: msg.content });
    estimatedTokens += msgTokens;
  }

  return history;
}

/** Lightweight token estimate for conversation history (excluding current turn). */
function estimateHistoryTokens(convMessages: Message[], currentRequestId: string): number {
  let total = 0;
  for (let i = convMessages.length - 1; i >= 0; i--) {
    const msg = convMessages[i];
    if (msg.requestId === currentRequestId) continue;
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    if (!msg.content || msg.content.length === 0) continue;
    if (msg.error || msg.stopped) continue;
    total += msg.promptEvalCount ?? Math.ceil(msg.content.length / 4);
  }
  return total;
}

/** Chars-per-token ratio used for char budget estimation (matches Rust chars/3). */
const CHARS_PER_TOKEN = 3;

/** Reserves for system prompt and current user prompt, in chars. */
const MIN_RAG_RESERVE_CHARS = 200;

/** Maximum character budget for RAG context. */
const RAG_MAX_CHARS = RAG_VALIDATION_LIMITS.MAX_RAG_CONTEXT_CHARS;

/**
 * Derive the character budget for RAG context assembly so it fits within the
 * model's context window alongside the system prompt, conversation history,
 * and current user message.
 *
 * Formula: min(MAX_RAG_CONTEXT_CHARS, numCtx * charsPerToken - reserveForPrompt - reserveForHistory)
 * Returns undefined when the budget is too small to be useful, letting the
 * RAG hook fall back to its default.
 */
function computeRagCharBudget(
  numCtx: number,
  systemPromptChars: number,
  historyTokens: number,
  currentPromptChars: number
): number | undefined {
  const totalCharCapacity = numCtx * CHARS_PER_TOKEN;
  const reserveForPrompt = systemPromptChars + currentPromptChars;
  const reserveForHistory = historyTokens * CHARS_PER_TOKEN;
  const remaining =
    totalCharCapacity - reserveForPrompt - reserveForHistory - MIN_RAG_RESERVE_CHARS;

  if (remaining <= 0) return undefined;
  return Math.min(RAG_MAX_CHARS, remaining);
}

/**
 * Build the chat API payload with full multi-message context:
 * [systemPrompt?, ...history, ragContext?, currentUserMessage]
 */
function buildChatPayload(
  ollamaUrl: string,
  messages: ChatMessage[],
  selectedModel: string,
  requestId: string,
  params: ModelParams,
  stop: string[]
) {
  return {
    baseUrl: ollamaUrl,
    messages,
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
      const resolved = selectResolvedParams(
        selectedModel,
        this.deps.contextWindow,
        this.deps.defaultParams
      );

      const systemPrompt = settingsState.globalSettings.systemPrompt;
      const systemPromptChars = systemPrompt ? systemPrompt.length : 0;
      const currentPromptChars = fullPrompt.length;

      const convMessages = messageStore.messages[currentConversationId] || [];
      const historyTokens = estimateHistoryTokens(convMessages, requestId);
      const ragMaxChars = computeRagCharBudget(
        resolved.numCtx,
        systemPromptChars,
        historyTokens,
        currentPromptChars
      );

      const { ragSources, assembledContext, ragTokenCount } = await assembleChatRag(
        trimmedInput,
        ragMaxChars
      );

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
        systemPrompt: settingsState.globalSettings.systemPrompt,
        assembledContext,
        ragTokenCount,
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
      const resolved = selectResolvedParams(
        selectedModel,
        this.deps.contextWindow,
        this.deps.defaultParams
      );

      const systemPrompt = settingsState.globalSettings.systemPrompt;
      const systemPromptChars = systemPrompt ? systemPrompt.length : 0;
      const currentPromptChars = fullPrompt.length;

      const convMessages = messageStore.messages[currentConversationId] || [];
      const historyTokens = estimateHistoryTokens(convMessages, requestId);
      const ragMaxChars = computeRagCharBudget(
        resolved.numCtx,
        systemPromptChars,
        historyTokens,
        currentPromptChars
      );

      const { ragSources, assembledContext, ragTokenCount } = await assembleChatRag(
        trimmedInput,
        ragMaxChars
      );

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
        systemPrompt: settingsState.globalSettings.systemPrompt,
        assembledContext,
        ragTokenCount,
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
    systemPrompt: string;
    assembledContext?: string;
    ragTokenCount?: number;
    t: TranslationFn;
    handleStreamError: HandleStreamError;
  }): Promise<void> {
    const {
      conversationId,
      requestId,
      ollamaUrl,
      fullPrompt,
      selectedModel,
      messages,
      systemPrompt,
      assembledContext,
      ragTokenCount,
      t,
    } = params;

    try {
      const resolved = selectResolvedParams(
        selectedModel,
        this.deps.contextWindow,
        this.deps.defaultParams
      );
      const numCtx = resolved.numCtx;

      // Estimate reserves for the token-budgeted history slice.
      const systemPromptTokens = systemPrompt ? Math.ceil(systemPrompt.length / 4) : 0;
      const ragTokens =
        ragTokenCount ?? (assembledContext ? Math.ceil(assembledContext.length / 4) : 0);
      const currentPromptTokens = Math.ceil(fullPrompt.length / 4);

      const convMessages = messages[conversationId] || [];
      const history = buildMessageHistory(convMessages, requestId, numCtx, {
        systemPrompt: systemPromptTokens,
        ragContext: ragTokens,
        currentPrompt: currentPromptTokens,
      });

      // Assemble the full messages array:
      // [systemPrompt?, ...history, ragContext?, currentUserMessage]
      const chatMessages: ChatMessage[] = [];
      if (systemPrompt) {
        chatMessages.push({ role: 'system', content: systemPrompt });
      }
      chatMessages.push(...history);
      if (assembledContext) {
        chatMessages.push({ role: 'system', content: assembledContext });
      }
      chatMessages.push({ role: 'user', content: fullPrompt });

      const payload = buildChatPayload(
        ollamaUrl,
        chatMessages,
        selectedModel,
        requestId,
        resolved,
        this.deps.paramsStop
      );
      const success = await chatApi.chat(payload);
      if (success !== true) throw new Error(t('chat.connectionFailed'));

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
