import { z } from 'zod';
import type { StoreOptions as StoreOptionsFull } from '@tauri-apps/plugin-store';
import {
  type ApiResponse,
  type OllamaModel,
  type ChatMessage,
  type ChatSettings,
  type OllamaHealthIpc,
  OllamaModelSchema,
  OllamaHealthIpcSchema,
  type ModelValidation,
  ModelValidationSchema,
  ModelNameSchema,
  RequestIdSchema,
  LanguageSchema,
  IpcChatMessageSchema,
  IpcChatOptionsSchema,
  LogEntrySchema,
  LogClearTokenSchema,
  VALIDATION_LIMITS,
  RagProjectSchema,
  SearchResultSchema,
  ProjectStatsSchema,
  ChunkRecordSchema,
  IndexStatusSchema,
  RagModelValidationSchema,
  RAG_VALIDATION_LIMITS,
  MAX_FILE_PATH_LEN,
  sanitizeError,
  COMMAND_VERSIONS,
  IPC_VERSION as _IPC_VERSION,
  MessageSchema,
  type CommandName,
  AssembledContextSchema,
  type Conversation,
  type Message,
  ConversationSchema,
  // Structured logging types
  TraceEntrySchema,
  TraceContextSchema,
  type TraceEntry,
  type TraceContext,
  type TraceStatus,
} from '@musaed/contracts';
import type {
  RagProject,
  SearchResult,
  ProjectStats,
  ChunkRecord,
  IndexStatus,
  RagModelValidation,
  AssembledContext,
} from '@musaed/contracts';
import toast from 'react-hot-toast';

/**
 * IPC Bridge — Strict Contract Architecture
 *
 * All Tauri IPC must route through this file. The bridge provides:
 * - Type-safe command dispatch via CommandMap
 * - Input/output validation using Zod schemas
 * - URL security validation for Ollama endpoints
 * - Error sanitization to prevent data leakage
 * - Contract version tracking (COMMAND_VERSIONS)
 *
 * Versioning: Each command in COMMAND_VERSIONS maps to its contract version.
 * Breaking changes require a new command (e.g., cmd_foo@v2) and an entry here.
 */
export interface CommandMap {
  cmd_ollama_get_models: { args: { baseUrl: string }; return: OllamaModel[] };
  cmd_ollama_chat: {
    args: {
      baseUrl: string;
      model: string;
      messages: ChatMessage[];
      options: Partial<ChatSettings>;
      requestId: string;
    };
    return: boolean;
  };
  cmd_ollama_abort_chat: { args: { requestId: string }; return: void };
  cmd_ollama_delete_model: { args: { baseUrl: string; name: string }; return: boolean };
  cmd_ollama_pull_model: { args: { baseUrl: string; name: string }; return: void };
  cmd_ollama_check_health: { args: { baseUrl: string }; return: OllamaHealthIpc };
  cmd_ollama_verify_service: { args: { baseUrl: string }; return: string };
  cmd_ollama_generate_title: {
    args: {
      baseUrl: string;
      model: string;
      userMessage: string;
      assistantMessage: string;
      language: string;
    };
    return: string;
  };
  cmd_ollama_validate_model: {
    args: { baseUrl: string; modelName: string };
    return: ModelValidation;
  };
  cmd_logs_append: { args: { entry: string }; return: void };
  cmd_logs_request_clear_token: { args: Record<string, never>; return: string };
  cmd_logs_clear: { args: { token: string }; return: void };

  // Tracing commands
  cmd_trace_append: { args: { input: TraceEntry }; return: void };
  cmd_trace_start: {
    args: { traceId: string; feature: string; action: string };
    return: TraceContext;
  };
  cmd_trace_complete: {
    args: {
      traceId: string;
      status: TraceStatus;
      message?: string;
      context?: Record<string, unknown>;
    };
    return: void;
  };
  cmd_trace_get_context: { args: { traceId: string }; return: TraceContext };

  // Dialog commands
  cmd_dialog_ask: { args: { title: string; message: string; kind?: string }; return: boolean };

  // Export commands
  cmd_export_markdown: { args: { conversationId: string; path: string }; return: boolean };

  // Opener commands
  cmd_opener_open_url: { args: { url: string }; return: boolean };

  // RAG commands
  cmd_rag_add_project: {
    args: { name: string; path: string; embeddingModel: string; ignorePatterns: string[] };
    return: RagProject;
  };
  cmd_rag_remove_project: { args: { projectId: string }; return: boolean };
  cmd_rag_update_project: {
    args: { projectId: string; name?: string; ignorePatterns?: string[] };
    return: RagProject;
  };
  cmd_rag_list_projects: { args: Record<string, never>; return: RagProject[] };
  cmd_rag_get_project: { args: { projectId: string }; return: RagProject };
  cmd_rag_index_project: {
    args: { projectId: string; force?: boolean; baseUrl?: string };
    return: boolean;
  };
  cmd_rag_abort_index: { args: { projectId: string }; return: boolean };
  cmd_rag_reindex_project: { args: { projectId: string; baseUrl?: string }; return: boolean };
  cmd_rag_retry_index_project: { args: { projectId: string; baseUrl?: string }; return: boolean };
  cmd_rag_get_index_status: { args: { projectId: string }; return: IndexStatus };
  cmd_rag_search: {
    args: { projectId: string; query: string; topK?: number; threshold?: number; baseUrl?: string };
    return: SearchResult[];
  };
  cmd_rag_get_file_chunks: { args: { projectId: string; filePath: string }; return: ChunkRecord[] };
  cmd_rag_get_project_stats: { args: { projectId: string }; return: ProjectStats };
  cmd_rag_set_embedding_model: { args: { projectId: string; modelName: string }; return: boolean };
  cmd_rag_validate_embedding_model: {
    args: { baseUrl?: string; modelName: string };
    return: RagModelValidation;
  };
  cmd_rag_assemble_context: {
    args: {
      projectId: string;
      query: string;
      topK?: number;
      threshold?: number;
      maxChars?: number;
      baseUrl?: string;
    };
    return: AssembledContext;
  };
  cmd_conversations_list: { args: Record<string, never>; return: Conversation[] };
  cmd_conversation_get: { args: { id: string }; return: Conversation };
  cmd_conversation_create: { args: { conversation: Conversation }; return: string };
  cmd_message_append: { args: { conversationId: string; message: Message }; return: void };
  cmd_conversation_delete: { args: { id: string }; return: void };
  cmd_conversations_clear: { args: Record<string, never>; return: void };
  cmd_conversation_update: { args: { id: string; title: string; updatedAt: number }; return: void };
}

const voidSchema = z.preprocess((val) => (val === null ? undefined : val), z.void());

/**
 * Maps command names to Zod schemas that validate the input arguments.
 * Entries are undefined when no validation is needed (e.g., empty object args).
 */
const CommandInputSchemas: {
  [K in keyof CommandMap]: z.ZodType<CommandMap[K]['args']> | undefined;
} = {
  cmd_ollama_get_models: undefined,
  cmd_ollama_chat: z.object({
    baseUrl: z.string(),
    model: ModelNameSchema,
    messages: z
      .array(IpcChatMessageSchema)
      .max(VALIDATION_LIMITS.MAX_MESSAGES_COUNT, 'Too many messages'),
    options: IpcChatOptionsSchema,
    requestId: RequestIdSchema,
  }),
  cmd_ollama_abort_chat: z.object({ requestId: RequestIdSchema }),
  cmd_ollama_delete_model: z.object({ baseUrl: z.string(), name: ModelNameSchema }),
  cmd_ollama_pull_model: z.object({ baseUrl: z.string(), name: ModelNameSchema }),
  cmd_ollama_check_health: undefined,
  cmd_ollama_verify_service: undefined,
  cmd_ollama_generate_title: z.object({
    baseUrl: z.string(),
    model: ModelNameSchema,
    userMessage: z
      .string()
      .max(VALIDATION_LIMITS.MAX_TITLE_INPUT_LEN, 'userMessage exceeds size limit'),
    assistantMessage: z
      .string()
      .max(VALIDATION_LIMITS.MAX_TITLE_INPUT_LEN, 'assistantMessage exceeds size limit'),
    language: LanguageSchema,
  }),
  cmd_ollama_validate_model: z.object({ baseUrl: z.string(), modelName: ModelNameSchema }),
  cmd_logs_append: z.object({ entry: LogEntrySchema }),
  cmd_logs_request_clear_token: undefined,
  cmd_logs_clear: z.object({ token: LogClearTokenSchema }),

  // Tracing command input schemas
  cmd_trace_append: z.object({ input: TraceEntrySchema }),
  cmd_trace_start: z.object({
    traceId: z.string().uuid('Invalid traceId format'),
    feature: z.string().min(1).max(VALIDATION_LIMITS.MAX_FEATURE_NAME_LEN),
    action: z.string().min(1).max(VALIDATION_LIMITS.MAX_ACTION_NAME_LEN),
  }),
  cmd_trace_complete: z.object({
    traceId: z.string().uuid('Invalid traceId format'),
    status: z.enum(['success', 'error', 'cancelled', 'timeout']),
    message: z.string().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  }),
  cmd_trace_get_context: z.object({ traceId: z.string().uuid('Invalid traceId format') }),

  // Dialog command input schemas
  cmd_dialog_ask: z.object({
    title: z.string().min(1).max(VALIDATION_LIMITS.MAX_TITLE_INPUT_LEN),
    message: z.string().min(1).max(VALIDATION_LIMITS.MAX_MESSAGE_CONTENT_LEN),
    kind: z.string().optional(),
  }),

  // Export command input schemas
  cmd_export_markdown: z.object({
    conversationId: z.string().min(1),
    path: z.string().min(1).max(RAG_VALIDATION_LIMITS.MAX_FILE_PATH_LEN),
  }),

  // Opener command input schemas
  cmd_opener_open_url: z.object({
    url: z.string().min(1).max(VALIDATION_LIMITS.MAX_MESSAGE_CONTENT_LEN),
  }),

  // RAG command input schemas
  cmd_rag_add_project: z.object({
    name: z.string().min(1).max(RAG_VALIDATION_LIMITS.MAX_PROJECT_NAME_LEN),
    path: z.string().min(1).max(RAG_VALIDATION_LIMITS.MAX_PROJECT_PATH_LEN),
    embeddingModel: ModelNameSchema,
    ignorePatterns: z
      .array(z.string().max(RAG_VALIDATION_LIMITS.MAX_IGNORE_PATTERN_LEN))
      .max(RAG_VALIDATION_LIMITS.MAX_IGNORE_PATTERNS),
  }),
  cmd_rag_remove_project: z.object({ projectId: z.string().min(1) }),
  cmd_rag_update_project: z.object({
    projectId: z.string().min(1),
    name: z.string().min(1).max(RAG_VALIDATION_LIMITS.MAX_PROJECT_NAME_LEN).optional(),
    ignorePatterns: z
      .array(z.string().max(RAG_VALIDATION_LIMITS.MAX_IGNORE_PATTERN_LEN))
      .max(RAG_VALIDATION_LIMITS.MAX_IGNORE_PATTERNS)
      .optional(),
  }),
  cmd_rag_list_projects: undefined,
  cmd_rag_get_project: z.object({ projectId: z.string().min(1) }),
  cmd_rag_index_project: z.object({
    projectId: z.string().min(1),
    force: z.boolean().optional(),
    baseUrl: z.string().optional(),
  }),
  cmd_rag_abort_index: z.object({ projectId: z.string().min(1) }),
  cmd_rag_reindex_project: z.object({
    projectId: z.string().min(1),
    baseUrl: z.string().optional(),
  }),
  cmd_rag_retry_index_project: z.object({
    projectId: z.string().min(1),
    baseUrl: z.string().optional(),
  }),
  cmd_rag_get_index_status: z.object({ projectId: z.string().min(1) }),
  cmd_rag_search: z.object({
    projectId: z.string().min(1),
    query: z.string().min(1).max(RAG_VALIDATION_LIMITS.MAX_SEARCH_QUERY_LEN),
    topK: z
      .number()
      .int()
      .min(RAG_VALIDATION_LIMITS.MIN_TOP_K)
      .max(RAG_VALIDATION_LIMITS.MAX_TOP_K)
      .optional(),
    threshold: z
      .number()
      .min(RAG_VALIDATION_LIMITS.MIN_THRESHOLD)
      .max(RAG_VALIDATION_LIMITS.MAX_THRESHOLD)
      .optional(),
    baseUrl: z.string().optional(),
  }),
  cmd_rag_get_file_chunks: z.object({
    projectId: z.string().min(1),
    filePath: z.string().min(1).max(MAX_FILE_PATH_LEN),
  }),
  cmd_rag_get_project_stats: z.object({ projectId: z.string().min(1) }),
  cmd_rag_set_embedding_model: z.object({
    projectId: z.string().min(1),
    modelName: ModelNameSchema,
  }),
  cmd_rag_validate_embedding_model: z.object({
    baseUrl: z.string().optional(),
    modelName: ModelNameSchema,
  }),
  cmd_rag_assemble_context: z.object({
    projectId: z.string().min(1),
    query: z.string().min(1).max(RAG_VALIDATION_LIMITS.MAX_SEARCH_QUERY_LEN),
    topK: z
      .number()
      .int()
      .min(RAG_VALIDATION_LIMITS.MIN_TOP_K)
      .max(RAG_VALIDATION_LIMITS.MAX_TOP_K)
      .optional(),
    threshold: z
      .number()
      .min(RAG_VALIDATION_LIMITS.MIN_THRESHOLD)
      .max(RAG_VALIDATION_LIMITS.MAX_THRESHOLD)
      .optional(),
    maxChars: z.number().int().min(1).max(RAG_VALIDATION_LIMITS.MAX_RAG_CONTEXT_CHARS).optional(),
    baseUrl: z.string().optional(),
  }),
  cmd_conversations_list: undefined,
  cmd_conversation_get: z.object({ id: z.string().min(1) }),
  cmd_conversation_create: z.object({
    conversation: ConversationSchema,
  }),
  cmd_message_append: z.object({
    conversationId: z.string().min(1),
    message: MessageSchema,
  }),
  cmd_conversation_delete: z.object({ id: z.string().min(1) }),
  cmd_conversations_clear: undefined,
  cmd_conversation_update: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    updatedAt: z.number(),
  }),
};

/**
 * Maps command names to Zod schemas that validate the return values.
 * Entries are undefined when no validation is needed (e.g., void).
 */
const CommandReturnSchemas: {
  [K in keyof CommandMap]: z.ZodType<CommandMap[K]['return']> | undefined;
} = {
  cmd_ollama_get_models: z.array(OllamaModelSchema),
  cmd_ollama_chat: z.boolean(),
  cmd_ollama_abort_chat: voidSchema,
  cmd_ollama_delete_model: z.boolean(),
  cmd_ollama_pull_model: voidSchema,
  cmd_ollama_check_health: OllamaHealthIpcSchema,
  cmd_ollama_verify_service: z.string(),
  cmd_ollama_generate_title: z.string(),
  cmd_ollama_validate_model: ModelValidationSchema,
  cmd_logs_append: voidSchema,
  cmd_logs_request_clear_token: z.string(),
  cmd_logs_clear: voidSchema,

  // Tracing command return schemas
  cmd_trace_append: voidSchema,
  cmd_trace_start: TraceContextSchema,
  cmd_trace_complete: voidSchema,
  cmd_trace_get_context: TraceContextSchema,

  // Dialog command return schemas
  cmd_dialog_ask: z.boolean(),

  // Export command return schemas
  cmd_export_markdown: z.boolean(),

  // Opener command return schemas
  cmd_opener_open_url: z.boolean(),

  // RAG command return schemas
  cmd_rag_add_project: RagProjectSchema,
  cmd_rag_remove_project: z.boolean(),
  cmd_rag_update_project: RagProjectSchema,
  cmd_rag_list_projects: z.array(RagProjectSchema),
  cmd_rag_get_project: RagProjectSchema,
  cmd_rag_index_project: z.boolean(),
  cmd_rag_abort_index: z.boolean(),
  cmd_rag_reindex_project: z.boolean(),
  cmd_rag_retry_index_project: z.boolean(),
  cmd_rag_get_index_status: IndexStatusSchema,
  cmd_rag_search: z.array(SearchResultSchema),
  cmd_rag_get_file_chunks: z.array(ChunkRecordSchema),
  cmd_rag_get_project_stats: ProjectStatsSchema,
  cmd_rag_set_embedding_model: z.boolean(),
  cmd_rag_validate_embedding_model: RagModelValidationSchema,
  cmd_rag_assemble_context: AssembledContextSchema,
  cmd_conversations_list: z.array(ConversationSchema),
  cmd_conversation_get: ConversationSchema,
  cmd_conversation_create: z.string(),
  cmd_message_append: voidSchema,
  cmd_conversation_delete: voidSchema,
  cmd_conversations_clear: voidSchema,
  cmd_conversation_update: voidSchema,
};

/**
 * Checks if the current runtime environment is a Tauri desktop application.
 * @returns true if running inside Tauri, false otherwise (e.g., browser dev mode)
 */
export const checkIsTauri = (): boolean =>
  typeof window !== 'undefined' &&
  !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

/**
 * Validates that the provided URL is a safe local-only target.
 * Only allows localhost, loopback, private IP ranges, and .local hostnames.
 * Strips any path, query, or fragment to prevent SSRF via path injection.
 * @param url - The URL to validate (full URL string)
 * @returns true if the URL is a permitted local address, false otherwise
 */
export const isValidOllamaUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const { hostname } = parsed;
    const isLocal =
      ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local');
    const isPrivateIP = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(hostname);
    return isLocal || isPrivateIP;
  } catch {
    return false;
  }
};

/**
 * Sanitizes a user-supplied Ollama URL by stripping path, query, and fragment.
 * Returns only scheme + host + port to prevent injection attacks.
 * If URL parsing fails, returns the original string unchanged.
 * @param url - The URL to sanitize
 * @returns A sanitized URL string containing only protocol, host, and optional port
 */
export const sanitizeOllamaUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url;
  }
};

/**
 * Internal helper to perform typed IPC calls via Tauri.
 * Handles input/output validation, URL security checks, and error sanitization.
 * @param command - The command key from CommandMap
 * @param args - The arguments object for the command
 * @param options - Optional flags (e.g., quiet suppresses toast errors)
 * @returns The validated return value from the Rust backend, or null if call was blocked
 * @throws {Error} If the backend returns an error or validation fails
 */
async function callInternal<K extends keyof CommandMap>(
  command: K,
  args: CommandMap[K]['args'],
  options?: { quiet?: boolean }
): Promise<CommandMap[K]['return'] | null> {
  // Dev-only contract registry check (ensures command is registered)
  if (process.env.NODE_ENV !== 'production') {
    const _guard: CommandName = command; // type check only; will throw if not assignable
    if (!(command in COMMAND_VERSIONS)) {
      // In development, warn about unregistered commands to prevent contract drift
      console.warn(`[IPC] Command "${command}" is not listed in COMMAND_VERSIONS contract map`);
    }
  }

  if (
    args &&
    'baseUrl' in args &&
    typeof args.baseUrl === 'string' &&
    !isValidOllamaUrl(args.baseUrl)
  ) {
    if (!options?.quiet) {
      toast.error('Security Block: Invalid or disallowed Ollama address.');
    }
    return null;
  }

  // Input validation via Zod schemas
  const inputSchema = CommandInputSchemas[command];
  if (inputSchema) {
    const inputResult = inputSchema.safeParse(args);
    if (!inputResult.success) {
      // Prevent raw Zod errors from leaking - extract only safe error message
      const safeMessage = inputResult.error.issues[0]?.message ?? 'Request validation failed';
      console.error(`[IPC] Input validation failed for "${command}"`);
      if (!options?.quiet) {
        toast.error(`Invalid request: ${safeMessage}`);
      }
      return null;
    }
  }

  if (!checkIsTauri()) return null;

  try {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    const response = await tauriInvoke<ApiResponse<CommandMap[K]['return']>>(command, args);

    const schema = CommandReturnSchemas[command];

    if (response?.success) {
      if (!schema) return response.data ?? true;
      const result = schema.safeParse(response.data);
      if (!result.success) {
        // Prevent raw Zod errors from leaking
        console.error(`[IPC] Response validation failed for "${command}"`, result.error.issues);
        throw new Error('Invalid response from backend');
      }
      return result.data;
    }

    if (response?.error) {
      // Sanitize the backend error before displaying to UI and return null to indicate failure
      const sanitized = sanitizeError(response.error);
      if (!options?.quiet) {
        toast.error(sanitized.message);
      }
      return null;
    }
    throw new Error('Unknown error occurred during IPC call');
  } catch (err) {
    // Ensure no raw errors escape - always sanitize
    const sanitized = sanitizeError(err);
    throw new Error(sanitized.message);
  }
}

/**
 * Ollama Engine API - manages Ollama server interactions.
 * - getModels: fetches list of installed models
 * - deleteModel: removes a model from the server
 * - pullModel: downloads a model (async, void return)
 * - checkHealth: checks if Ollama is running (quiet, no toast)
 * - verifyService: performs a simple ping to verify Ollama responds
 * - validateModel: checks if a model name is valid and available
 */
export const ollamaApi = {
  /**
   * Fetches the list of installed models from the Ollama server.
   * @param baseUrl - The Ollama server URL (e.g., http://localhost:11434)
   * @returns Array of model info or null if call failed/blocked
   */
  getModels: (baseUrl: string) => callInternal('cmd_ollama_get_models', { baseUrl }),
  /**
   * Deletes a model from the Ollama server.
   * @param baseUrl - The Ollama server URL
   * @param name - Name of the model to delete
   * @returns true if deletion succeeded, false otherwise
   */
  deleteModel: (baseUrl: string, name: string) =>
    callInternal('cmd_ollama_delete_model', { baseUrl, name }),
  /**
   * Starts pulling (downloading) a model. This is an async operation on the backend.
   * @param baseUrl - The Ollama server URL
   * @param name - Name of the model to pull
   */
  pullModel: (baseUrl: string, name: string) =>
    callInternal('cmd_ollama_pull_model', { baseUrl, name }),
  /**
   * Checks the health of the Ollama server (quiet mode, no toast on failure).
   * @param baseUrl - The Ollama server URL
   * @returns Health data including version and response time, or null if unhealthy/blocked
   */
  checkHealth: (baseUrl: string) =>
    callInternal('cmd_ollama_check_health', { baseUrl }, { quiet: true }),
  /**
   * Verifies that the Ollama service is reachable and responsive.
   * @param baseUrl - The Ollama server URL
   * @returns A status string (typically "ok") or empty on failure
   */
  verifyService: (baseUrl: string) => callInternal('cmd_ollama_verify_service', { baseUrl }),
  /**
   * Validates that a model exists and is ready for use.
   * @param baseUrl - The Ollama server URL
   * @param modelName - The model name to validate
   * @returns Validation result with status and optional error message
   */
  validateModel: (baseUrl: string, modelName: string) =>
    callInternal('cmd_ollama_validate_model', { baseUrl, modelName }),
};

/**
 * Chat & Interaction API - handles streaming chat and abort control.
 * - chat: initiates a streaming chat request (stream handled separately)
 * - abort: cancels an ongoing chat by requestId
 */
export const chatApi = {
  /**
   * Initiates a chat completion. Returns immediately with boolean; streaming handled via events.
   * @param args - Chat arguments including messages, model, options, and requestId
   * @returns true if request was accepted, false if blocked/validation failed
   */
  chat: (args: CommandMap['cmd_ollama_chat']['args']) => callInternal('cmd_ollama_chat', args),
  /**
   * Aborts an in-progress chat request.
   * @param requestId - The request identifier returned from the chat call
   */
  abort: (requestId: string) => callInternal('cmd_ollama_abort_chat', { requestId }),
};

/**
 * Title Generation API - generates chat titles from conversation snippets.
 */
export const titleApi = {
  /**
   * Generates a concise title for a chat session based on the first user/assistant exchange.
   * Runs in quiet mode (no toast errors).
   * @param args - Contains baseUrl, model, userMessage, assistantMessage, and language
   * @returns Generated title string, or empty on failure
   */
  generate: (args: CommandMap['cmd_ollama_generate_title']['args']) =>
    callInternal('cmd_ollama_generate_title', args, { quiet: true }),
};

/**
 * Logging & Diagnostics API - writes to the application log stream.
 */
export const logApi = {
  /**
   * Appends a log entry to the persistent log stream.
   * @param entry - Log message string (will be validated/truncated per limits)
   */
  append: (entry: string) => callInternal('cmd_logs_append', { entry }),
  /**
   * Requests a confirmation token, then clears all log entries.
   * The two-step token pattern ensures the clear operation was explicitly
   * authorized by the backend, preventing unauthorized log destruction.
   */
  clear: async () => {
    const token = await callInternal('cmd_logs_request_clear_token', {});
    if (!token) return null;
    return callInternal('cmd_logs_clear', { token });
  },
};

/**
 * Structured Tracing API - propagates trace context across IPC boundaries.
 * Implements the observability model from QWEN.md §14.
 */
export const traceApi = {
  /**
   * Appends a complete trace entry to the persistent log stream.
   * @param input - Structured trace entry with all required fields
   */
  append: (input: CommandMap['cmd_trace_append']['args']['input']) =>
    callInternal('cmd_trace_append', { input }),
  /**
   * Starts a new trace span and registers it for context propagation.
   * @param traceId - Unique trace identifier (UUID v4)
   * @param feature - Feature domain (e.g., "chat", "rag", "ollama")
   * @param action - Action name (e.g., "sendMessage", "indexProject")
   * @returns Trace context for IPC propagation
   */
  start: (traceId: string, feature: string, action: string) =>
    callInternal('cmd_trace_start', { traceId, feature, action }),
  /**
   * Completes an active trace span with status.
   * @param traceId - The trace identifier
   * @param status - Completion status (success, error, cancelled, timeout)
   * @param message - Optional human-readable message
   * @param context - Optional contextual metadata
   */
  complete: (
    traceId: string,
    status: CommandMap['cmd_trace_complete']['args']['status'],
    message?: string,
    context?: Record<string, unknown>
  ) => callInternal('cmd_trace_complete', { traceId, status, message, context }),
  /**
   * Gets the current trace context for an active trace.
   * @param traceId - The trace identifier
   * @returns Trace context with current span information
   */
  getContext: (traceId: string) => callInternal('cmd_trace_get_context', { traceId }),
};

/**
 * Dialog API - manages user dialog interactions.
 */
export const dialogApi = {
  /**
   * Shows a dialog to the user and returns their response.
   * @param title - The dialog title
   * @param message - The dialog message
   * @param kind - Optional dialog kind (e.g., 'info', 'warning', 'error')
   * @returns true if user confirmed, false if cancelled
   */
  ask: (title: string, message: string, kind?: string) =>
    callInternal('cmd_dialog_ask', { title, message, kind }),
};

/**
 * Export API - handles data export functionality.
 */
export const exportApi = {
  /**
   * Exports a conversation to Markdown format.
   * @param conversationId - The conversation ID to export
   * @param path - The file path to save to
   * @returns true if export succeeded, false otherwise
   */
  markdown: (conversationId: string, path: string) =>
    callInternal('cmd_export_markdown', { conversationId, path }),
};

/**
 * Opener API - handles external URL opening.
 */
export const openerApi = {
  /**
   * Opens a URL in the user's default browser.
   * @param url - The URL to open
   * @returns true if URL was opened successfully, false otherwise
   */
  openUrl: (url: string) => callInternal('cmd_opener_open_url', { url }),
};

/**
 * RAG (Retrieval-Augmented Generation) API - manages project indexing and semantic search.
 */
export const ragApi = {
  /**
   * Creates a new RAG project by registering a folder path and embedding model.
   * @param args - { name, path, embeddingModel, ignorePatterns[] }
   * @returns The created RagProject object or null on failure
   */
  addProject: (args: CommandMap['cmd_rag_add_project']['args']) =>
    callInternal('cmd_rag_add_project', args),
  /**
   * Removes a RAG project (does not delete files on disk).
   * @param projectId - The unique project identifier
   * @returns true if removal succeeded, false otherwise
   */
  removeProject: (projectId: string) => callInternal('cmd_rag_remove_project', { projectId }),
  /**
   * Updates an existing project's name or ignore patterns.
   * @param args - { projectId, name?, ignorePatterns? }
   * @returns The updated RagProject object or null on failure
   */
  updateProject: (args: CommandMap['cmd_rag_update_project']['args']) =>
    callInternal('cmd_rag_update_project', args),
  /**
   * Lists all registered RAG projects.
   * @returns Array of RagProject objects
   */
  listProjects: () => callInternal('cmd_rag_list_projects', {}),
  /**
   * Fetches a single project by ID.
   * @param projectId - The project identifier
   * @returns The RagProject object or null if not found
   */
  getProject: (projectId: string) => callInternal('cmd_rag_get_project', { projectId }),
  /**
   * Triggers indexing of all files in a project.
   * @param projectId - The project identifier
   * @param force - If true, reindexes already indexed files
   * @param baseUrl - Optional Ollama base URL for embedding
   * @returns true if indexing started, false otherwise
   */
  indexProject: (projectId: string, force?: boolean, baseUrl?: string) =>
    callInternal('cmd_rag_index_project', { projectId, force, baseUrl }),
  /**
   * Aborts an ongoing indexing operation.
   * @param projectId - The project identifier
   * @returns true if abort was signaled, false otherwise
   */
  abortIndex: (projectId: string) => callInternal('cmd_rag_abort_index', { projectId }),
  /**
   * Reindexes a project (shortcut for abort + index).
   * @param projectId - The project identifier
   * @param baseUrl - Optional Ollama base URL for embedding
   * @returns true if reindexing started, false otherwise
   */
  reindexProject: (projectId: string, baseUrl?: string) =>
    callInternal('cmd_rag_reindex_project', { projectId, baseUrl }),
  /**
   * Retries a failed indexing operation for a project.
   * @param projectId - The project identifier
   * @param baseUrl - Optional Ollama base URL (uses default if omitted)
   * @returns true if retry started successfully, false otherwise
   */
  retryIndexProject: (projectId: string, baseUrl?: string) =>
    callInternal('cmd_rag_retry_index_project', { projectId, baseUrl }),
  /**
   * Gets the current indexing status for a project.
   * @param projectId - The project identifier
   * @returns IndexStatus object with progress and state
   */
  getIndexStatus: (projectId: string) => callInternal('cmd_rag_get_index_status', { projectId }),
  /**
   * Performs a semantic search over indexed content.
   * @param args - { projectId, query, topK?, threshold?, baseUrl? }
   * @returns Array of SearchResult with matched chunks and scores
   */
  search: (args: CommandMap['cmd_rag_search']['args']) => callInternal('cmd_rag_search', args),
  /**
   * Fetches all chunk records for a specific file within a project.
   * @param projectId - The project identifier
   * @param filePath - Absolute path to the file
   * @returns Array of ChunkRecord objects
   */
  getFileChunks: (projectId: string, filePath: string) =>
    callInternal('cmd_rag_get_file_chunks', { projectId, filePath }),
  /**
   * Gets aggregate statistics for a project (file count, chunk count, size, etc.).
   * @param projectId - The project identifier
   * @returns ProjectStats object or null on failure
   */
  getProjectStats: (projectId: string) => callInternal('cmd_rag_get_project_stats', { projectId }),
  /**
   * Changes the embedding model used by a project.
   * @param projectId - The project identifier
   * @param modelName - Name of the embedding model to switch to
   * @returns true if model was updated successfully, false otherwise
   */
  setEmbeddingModel: (projectId: string, modelName: string) =>
    callInternal('cmd_rag_set_embedding_model', { projectId, modelName }),
  /**
   * Validates that an embedding model is available and acceptable.
   * @param baseUrl - Optional Ollama base URL (uses default if omitted)
   * @param modelName - The embedding model name to validate
   * @returns RagModelValidation with status and optional message
   */
  validateEmbeddingModel: (baseUrl: string | undefined, modelName: string) =>
    callInternal('cmd_rag_validate_embedding_model', { baseUrl, modelName }),
  /**
   * Performs semantic search and assembles a RAG context prompt in a single IPC call.
   * Replaces the previous two-step process of search + client-side context assembly.
   * @param args - { projectId, query, topK?, threshold?, maxChars?, baseUrl? }
   * @returns AssembledContext with the formatted context string, citations, and token count
   */
  assembleContext: (args: CommandMap['cmd_rag_assemble_context']['args']) =>
    callInternal('cmd_rag_assemble_context', args),
};

/**
 * Subscribes to a Tauri event from the backend.
 * If a Zod schema is provided, payloads are validated before being passed to the handler.
 * Invalid payloads are logged and discarded.
 * @param event - The event name string
 * @param handler - Callback function to process validated event payloads
 * @param schema - Optional Zod schema for payload validation
 * @returns A function that unsubscribes from the event when called
 */
export async function listen<T>(
  event: string,
  handler: (payload: T) => void,
  schema?: z.ZodType<T>
): Promise<() => void> {
  if (!checkIsTauri()) return () => {};

  const { listen: tauriListen } = await import('@tauri-apps/api/event');
  return await tauriListen<T>(event, (e) => {
    if (schema) {
      const result = schema.safeParse(e.payload);
      if (result.success) {
        handler(result.data);
      } else {
        // Prevent raw Zod errors from leaking
        console.error(`[IPC] Event "${event}" payload validation failed`);
      }
    } else {
      handler(e.payload);
    }
  });
}

/**
 * Wrapper around Tauri's dialog plugin with browser fallbacks.
 * - `ask`: Shows a confirmation dialog; uses window.confirm in browser.
 * - `save`: Shows a file save dialog; returns null in browser.
 * - `open`: Shows a file/folder open dialog; returns null in browser.
 */
export const dialog = {
  ask: async (msg: string, opts: { title?: string; kind?: 'info' | 'warning' | 'error' }) =>
    checkIsTauri()
      ? (await import('@tauri-apps/plugin-dialog')).ask(msg, opts)
      : window.confirm(msg),
  save: async (opts: {
    filters: { name: string; extensions: string[] }[];
    defaultPath?: string;
  }) => (checkIsTauri() ? (await import('@tauri-apps/plugin-dialog')).save(opts) : null),
  open: async (opts: {
    filters?: { name: string; extensions: string[] }[];
    multiple?: boolean;
    directory?: boolean;
    defaultPath?: string;
  }): Promise<string | string[] | null> =>
    checkIsTauri() ? (await import('@tauri-apps/plugin-dialog')).open(opts) : null,
};

/**
 * Allowed URL patterns for the opener plugin.
 * Must stay in sync with `src-tauri/capabilities/default.json`.
 */
const OPENER_ALLOWED_PATTERNS: readonly RegExp[] = [
  /^https:\/\/github\.com\/alfrahi\/musaed\/.+$/,
  /^https:\/\/github\.com\/Alfrahi\/Musaed\/.+$/,
  /^https:\/\/github\.com\/alfrahi\/musaed$/,
  /^https:\/\/github\.com\/Alfrahi\/Musaed$/,
  /^https:\/\/ollama\.com\/.+$/,
  /^https:\/\/ollama\.com$/,
  /^https:\/\/ollama\.ai\/.+$/,
  /^https:\/\/ollama\.ai$/,
  /^mailto:/,
];

function isOpenerUrlAllowed(url: string): boolean {
  return OPENER_ALLOWED_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * Wrapper around Tauri's opener plugin.
 * - `openUrl`: Opens a URL in the default browser; uses window.open in browser (may be blocked).
 *   URLs are validated against the allowlist before being passed to the native layer.
 */
export const opener = {
  openUrl: async (url: string) => {
    if (!isOpenerUrlAllowed(url)) return;
    if (checkIsTauri()) {
      return (await import('@tauri-apps/plugin-opener')).openUrl(url);
    }
    // Validate URL protocol before opening in browser dev mode
    const allowedProtocols = ['http:', 'https:', 'mailto:'];
    try {
      const parsed = new URL(url);
      if (!allowedProtocols.includes(parsed.protocol)) return;
    } catch {
      return; // Invalid URL — silently reject
    }
    window.open(url, '_blank');
  },
};

/**
 * Wrapper around Tauri's store plugin for persistent key-value storage.
 * - `load`: Loads a store file; returns null in browser.
 * Provides a simple key-value store interface backed by a JSON file.
 */
export type StoreOptions = Partial<StoreOptionsFull>;

export const store = {
  load: async (file: string, opts?: StoreOptions) =>
    checkIsTauri()
      ? (await import('@tauri-apps/plugin-store')).load(file, opts as StoreOptionsFull)
      : null,
};

/**
 * Wrapper around Tauri's filesystem plugin.
 * - `writeTextFile`: Writes a text file to the local filesystem.
 * - `readTextFile`: Reads a text file and returns its contents as a string.
 * - `readFile`: Reads a binary file and returns a Uint8Array.
 * All methods are no-ops (return null/undefined) when running in a browser.
 */
export const fs = {
  writeTextFile: async (path: string, content: string) =>
    checkIsTauri() && (await import('@tauri-apps/plugin-fs')).writeTextFile(path, content),
  readTextFile: async (path: string): Promise<string | null> =>
    checkIsTauri() ? (await import('@tauri-apps/plugin-fs')).readTextFile(path) : null,
  readFile: async (path: string): Promise<Uint8Array | null> =>
    checkIsTauri() ? (await import('@tauri-apps/plugin-fs')).readFile(path) : null,
};

/**
 * Conversation & Message APIs - manages conversation persistence operations.
 * - listConversations: fetches all conversations from backend storage
 * - getConversation: fetches a specific conversation by ID
 * - createConversation: creates a new conversation
 * - appendMessage: adds a message to a conversation
 * - deleteConversation: removes a conversation by ID
 * - clearAllConversations: removes all conversations
 */
export const conversationApi = {
  listConversations: () => callInternal('cmd_conversations_list', {}),
  getConversation: (id: string) => callInternal('cmd_conversation_get', { id }),
  createConversation: (conversation: Conversation) =>
    callInternal('cmd_conversation_create', { conversation }),
  appendMessage: (conversationId: string, message: Message) =>
    callInternal('cmd_message_append', { conversationId, message }),
  deleteConversation: (id: string) => callInternal('cmd_conversation_delete', { id }),
  clearAllConversations: () => callInternal('cmd_conversations_clear', {}),
  updateConversation: (id: string, title: string, updatedAt: number) =>
    callInternal('cmd_conversation_update', { id, title, updatedAt }),
};
