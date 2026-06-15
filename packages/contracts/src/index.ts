'use client';

import { z } from 'zod';

export enum BackendErrorCode {
  // ── Network / connectivity ────────────────────────────
  NetworkError = 'NETWORK_ERROR',
  ConnectionFailed = 'CONNECTION_FAILED',
  Timeout = 'TIMEOUT',

  // ── Ollama service ────────────────────────────────────
  OllamaUnavailable = 'OLLAMA_UNAVAILABLE',
  OllamaError = 'OLLAMA_ERROR',
  NotOllama = 'NOT_OLLAMA',
  ModelNotFound = 'MODEL_NOT_FOUND',
  HealthCheckTimeout = 'HEALTH_CHECK_TIMEOUT',
  HealthCheckFailed = 'HEALTH_CHECK_FAILED',

  // ── Validation / input ────────────────────────────────
  InvalidRequest = 'INVALID_REQUEST',
  InvalidInput = 'INVALID_INPUT',
  InvalidUrl = 'INVALID_URL',
  InvalidResponse = 'INVALID_RESPONSE',

  // ── Rate limiting / concurrency ───────────────────────
  RateLimited = 'RATE_LIMITED',
  DuplicateRequest = 'DUPLICATE_REQUEST',

  // ── Streaming ─────────────────────────────────────────
  StreamTimeout = 'STREAM_TIMEOUT',
  StreamIdleTimeout = 'STREAM_IDLE_TIMEOUT',

  // ── File system ───────────────────────────────────────
  FileSystemError = 'FILE_SYSTEM_ERROR',
  FileTooLarge = 'FILE_TOO_LARGE',

  // ── Parse / response ──────────────────────────────────
  ParseError = 'PARSE_ERROR',
  DeleteError = 'DELETE_ERROR',

  // ── Title generation ──────────────────────────────────
  EmptyTitle = 'EMPTY_TITLE',
  ReasoningInsteadOfTitle = 'REASONING_INSTEAD_OF_TITLE',

  // ── RAG ───────────────────────────────────────────────
  RagCreateError = 'RAG_CREATE_ERROR',
  RagDeleteError = 'RAG_DELETE_ERROR',
  RagUpdateError = 'RAG_UPDATE_ERROR',
  RagNotFoundError = 'RAG_NOT_FOUND',
  RagFetchError = 'RAG_FETCH_ERROR',
  RagListError = 'RAG_LIST_ERROR',
  RagSearchError = 'RAG_SEARCH_ERROR',
  RagStatsError = 'RAG_STATS_ERROR',
  RagValidationError = 'RAG_VALIDATION_ERROR',
  RagAlreadyIndexing = 'RAG_ALREADY_INDEXING',

  // ── Conversation ──────────────────────────────────────
  ConversationNotFound = 'CONVERSATION_NOT_FOUND',
  ConversationFetchError = 'CONVERSATION_FETCH_ERROR',
  ConversationListError = 'CONVERSATION_LIST_ERROR',
  ConversationCreateError = 'CONVERSATION_CREATE_ERROR',
  ConversationDeleteError = 'CONVERSATION_DELETE_ERROR',
  ConversationUpdateError = 'CONVERSATION_UPDATE_ERROR',
  MessageAppendError = 'MESSAGE_APPEND_ERROR',
  ConversationLockError = 'CONVERSATION_LOCK_ERROR',

  // ── Generic ───────────────────────────────────────────
  InternalError = 'INTERNAL_ERROR',
  Aborted = 'ABORTED',
  Unknown = 'UNKNOWN',
}

/** Set of all valid error code strings for CI validation. */
export const BACKEND_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.values(BackendErrorCode) as string[]
);

export const BackendErrorSchema = z
  .object({
    code: z.string().default(BackendErrorCode.Unknown),
    message: z.string(),
    requestId: z.string().nullish(),
    context: z.string().nullish(),
    isRetryable: z.boolean().default(false),
  })
  .transform((data) => ({
    ...data,
    requestId: data.requestId,
    context: data.context,
  }));

export type BackendError = z.infer<typeof BackendErrorSchema>;

/**
 * Sanitizes errors by redacting sensitive system paths, URLs, and stack traces
 * while ensuring type safety. Prevents information leakage from backend errors.
 */
export const sanitizeError = (error: unknown): BackendError => {
  let message = 'An unknown error occurred';
  let code = BackendErrorCode.Unknown;
  let requestId: string | undefined;

  if (typeof error === 'string') {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (error !== null && typeof error === 'object') {
    const errObj = error as Record<string, unknown>;

    if (typeof errObj.message === 'string') {
      message = errObj.message;
    }

    if (typeof errObj.code === 'string') {
      code = errObj.code as BackendErrorCode;
    }

    const rid = errObj.requestId;
    if (typeof rid === 'string') {
      requestId = rid;
    }
  }

  // Step 1: Redact sensitive URLs while preserving localhost for debugging
  const urlRegex = /(https?:\/\/(?!localhost|127\.0\.0\.1|::1)[^\s<>"{}|\\^`\[\]]+)/gi;
  message = message.replace(urlRegex, '[URL REDACTED]');

  // Step 2: Redact database connection strings before path redaction
  const dbRegex = /(mongodb|postgres|mysql|redis):\/\/[^\s]+/gi;
  message = message.replace(dbRegex, '[CONNECTION STRING REDACTED]');

  // Step 3: Redact filesystem paths (Unix and Windows)
  // Unix-style: /home/user/..., /root/..., /etc/...
  const unixPathRegex =
    /\/(?:home|root|etc|usr|var|opt|srv|tmp|mnt|proc|sys|dev|boot|lib|bin|sbin|Applications?|Users?)[^\s]*/gi;
  message = message.replace(unixPathRegex, '[PATH REDACTED]');

  // Windows-style: C:\..., D:\..., etc.
  const winPathRegex = /[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g;
  message = message.replace(winPathRegex, '[PATH REDACTED]');

  // Generic absolute paths
  const genericPathRegex = /([a-zA-Z]:\\(?:[^\\\s]+\\)+|(?:\/[^/\s]+)+\/)/g;
  message = message.replace(genericPathRegex, '[PATH REDACTED]');

  // Step 4: Remove remaining sensitive patterns (API keys, private IPs, stack traces)
  const sensitivePatterns: Array<[RegExp, string]> = [
    // API keys/tokens
    [/(api[_-]?key|token|secret|password|passwd|pwd)[=:]\s*["']?[\w-]{8,}["']?/gi, '$1=[REDACTED]'],
    // Private IPs (but keep localhost)
    [
      /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}(?::\d+)?/g,
      '[PRIVATE IP REDACTED]',
    ],
    // Stack traces - remove file:line:col patterns
    [/(?:File|at)\s+["'][^"']+["']:\d+:\d+/g, '[LOCATION REDACTED]'],
    [
      /(?:File|at)\s+["'][^"']+["'],?\s*line\s+\d+(?:,?\s*col(?:umn)?\s+\d+)?/gi,
      '[LOCATION REDACTED]',
    ],
  ];

  for (const [pattern, replacement] of sensitivePatterns) {
    message = message.replace(pattern, replacement);
  }

  // Step 5: Normalize whitespace and trim
  message = message.replace(/\s+/g, ' ').trim();

  // Step 6: Fallback for completely empty messages
  if (!message || message.length < 2) {
    message = 'An error occurred. Please try again.';
  }

  return {
    code,
    message,
    requestId,
    context: null,
    isRetryable: false,
  };
};

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: BackendError;
}

// ====================== IPC INPUT VALIDATION ======================

// Import validation constants from the single source of truth so they are
// available as local bindings for Zod schemas below, and re-export them for
// external consumers.
// See packages/contracts/src/validation-limits.ts for documentation.
import {
  VALIDATION_LIMITS,
  RAG_VALIDATION_LIMITS,
  VALID_ROLES,
  VALID_LANGUAGES,
  MAX_FILE_PATH_LEN,
} from './validation-limits';

export {
  VALIDATION_LIMITS,
  RAG_VALIDATION_LIMITS,
  VALID_ROLES,
  VALID_LANGUAGES,
  MAX_FILE_PATH_LEN,
};

const MODEL_NAME_RE = /^[a-zA-Z0-9._:-]+$/;

/** Validates a model name matches the allowed character set and length. */
export const ModelNameSchema = z
  .string()
  .min(1)
  .max(VALIDATION_LIMITS.MAX_MODEL_NAME_LEN)
  .regex(MODEL_NAME_RE, 'Model name contains invalid characters');

/** Validates a request ID (alphanumeric, dash, underscore). */
export const RequestIdSchema = z
  .string()
  .min(1)
  .max(VALIDATION_LIMITS.MAX_REQUEST_ID_LEN)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Request ID contains invalid characters');

/** Validates a language code is 'en' or 'ar'. */
export const LanguageSchema = z.enum(['en', 'ar']);

/** Validates a chat role. */
export const ChatRoleSchema = z.enum(['system', 'user', 'assistant']);

/** Validates ChatMessage with size/count limits. */
export const IpcChatMessageSchema = z.object({
  role: ChatRoleSchema,
  content: z
    .string()
    .max(VALIDATION_LIMITS.MAX_MESSAGE_CONTENT_LEN, 'Message content exceeds size limit'),
  images: z
    .array(z.string().max(VALIDATION_LIMITS.MAX_IMAGE_B64_LEN, 'Image exceeds size limit'))
    .max(VALIDATION_LIMITS.MAX_IMAGES_PER_MESSAGE, 'Too many images per message')
    .optional(),
});

/** Validates ChatOptions with numeric range constraints. */
export const IpcChatOptionsSchema = z.object({
  temperature: z
    .number()
    .min(VALIDATION_LIMITS.TEMPERATURE_RANGE[0])
    .max(VALIDATION_LIMITS.TEMPERATURE_RANGE[1])
    .optional(),
  topK: z
    .number()
    .int()
    .min(VALIDATION_LIMITS.TOP_K_RANGE[0])
    .max(VALIDATION_LIMITS.TOP_K_RANGE[1])
    .optional(),
  topP: z
    .number()
    .min(VALIDATION_LIMITS.TOP_P_RANGE[0])
    .max(VALIDATION_LIMITS.TOP_P_RANGE[1])
    .optional(),
  numPredict: z
    .number()
    .int()
    .min(VALIDATION_LIMITS.NUM_PREDICT_RANGE[0])
    .max(VALIDATION_LIMITS.NUM_PREDICT_RANGE[1])
    .optional(),
  numCtx: z
    .number()
    .int()
    .min(VALIDATION_LIMITS.NUM_CTX_RANGE[0])
    .max(VALIDATION_LIMITS.NUM_CTX_RANGE[1])
    .optional(),
  stop: z
    .array(z.string().max(VALIDATION_LIMITS.MAX_STOP_SEQUENCE_LEN))
    .max(VALIDATION_LIMITS.MAX_STOP_SEQUENCES)
    .optional(),
});

/** Validates a log entry string. */
export const LogEntrySchema = z
  .string()
  .max(VALIDATION_LIMITS.MAX_LOG_ENTRY_LEN, 'Log entry exceeds size limit');

/** Validates a log-clear confirmation token (UUID v4 format). */
export const LogClearTokenSchema = z
  .string()
  .min(1)
  .max(VALIDATION_LIMITS.MAX_LOG_CLEAR_TOKEN_LEN, 'Clear token exceeds size limit');

// ====================== STRUCTURED LOGGING TYPES ======================

/** Log level for structured tracing. */
export const LogLevelSchema = z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/** Trace status for structured logging. */
export const TraceStatusSchema = z.enum(['success', 'error', 'cancelled', 'timeout']);
export type TraceStatus = z.infer<typeof TraceStatusSchema>;

/** Trace context for propagating trace metadata across IPC boundaries. */
export const TraceContextSchema = z.object({
  traceId: z.string().uuid('Invalid traceId format'),
  parentSpanId: z.string().uuid('Invalid spanId format').optional(),
  feature: z
    .string()
    .min(1)
    .max(VALIDATION_LIMITS.MAX_FEATURE_NAME_LEN, 'Feature name exceeds limit'),
  action: z.string().min(1).max(VALIDATION_LIMITS.MAX_ACTION_NAME_LEN, 'Action name exceeds limit'),
});
export type TraceContext = z.infer<typeof TraceContextSchema>;

/** Structured trace entry for observability. */
export const TraceEntrySchema = z.object({
  timestamp: z.string().datetime('Invalid timestamp format'),
  traceId: z.string().uuid('Invalid traceId format'),
  spanId: z.string().uuid('Invalid spanId format'),
  parentSpanId: z.string().uuid('Invalid spanId format').optional(),
  feature: z
    .string()
    .min(1)
    .max(VALIDATION_LIMITS.MAX_FEATURE_NAME_LEN, 'Feature name exceeds limit'),
  action: z.string().min(1).max(VALIDATION_LIMITS.MAX_ACTION_NAME_LEN, 'Action name exceeds limit'),
  level: LogLevelSchema,
  status: TraceStatusSchema.optional(),
  latencyMs: z.number().int().min(0).optional(),
  message: z.string().max(VALIDATION_LIMITS.MAX_TRACE_MESSAGE_LEN, 'Message exceeds size limit'),
  source: z.enum(['frontend', 'backend', 'ipc']),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type TraceEntry = z.infer<typeof TraceEntrySchema>;

export const OllamaModelDetailsSchema = z.object({
  format: z.string().nullish(),
  family: z.string().nullish(),
  parameterSize: z.string().nullish(),
  quantizationLevel: z.string().nullish(),
});

export const OllamaModelSchema = z.object({
  name: z.string(),
  size: z.number().nullish(),
  digest: z.string().nullish(),
  details: OllamaModelDetailsSchema.nullish(),
});

export type OllamaModel = z.infer<typeof OllamaModelSchema>;

/** Persists the user's last selected model across sessions. */
export const ModelStateSchema = z.object({
  selectedModel: z.string().default(''),
});

export type ModelState = z.infer<typeof ModelStateSchema>;

export const DEFAULT_MODEL_STATE: ModelState = {
  selectedModel: '',
};

export const ChatMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
  images: z.array(z.string()).optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const OllamaTokenSchema = z.object({
  model: z.string().nullish(),
  createdAt: z.string().nullish(),
  message: ChatMessageSchema.nullish(),
  done: z.boolean().default(false),
  totalDuration: z.number().nullish(),
  loadDuration: z.number().nullish(),
  promptEvalCount: z.number().nullish(),
  promptEvalDuration: z.number().nullish(),
  evalCount: z.number().nullish(),
  evalDuration: z.number().nullish(),
  requestId: z.string().nullish(),
});

export type OllamaToken = z.infer<typeof OllamaTokenSchema>;

export const PullProgressSchema = z.object({
  status: z.string(),
  digest: z.string().nullish(),
  completed: z.number().nullish(),
  total: z.number().nullish(),
  name: z.string().nullish(),
  percentage: z.number().nullish(),
});

export type PullProgress = z.infer<typeof PullProgressSchema>;

export const PullErrorSchema = z.object({
  name: z.string(),
  error: z.string(),
  duration: z.coerce.number().optional(),
});

export type PullError = z.infer<typeof PullErrorSchema>;

// Re-export thinking-tag utilities from the shared module (avoids circular deps with workerUtils)
export {
  REDACTED_THINKING_TAG_START,
  REDACTED_THINKING_TAG_END,
  THINK_TAG_START,
  THINK_TAG_END,
  THOUGHTS_TAG_START,
  THOUGHTS_TAG_END,
  REASONING_TAG_START,
  REASONING_TAG_END,
  INITIAL_THOUGHTS_TAG_START,
  INITIAL_THOUGHTS_TAG_END,
  THINKING_REGEX_SOURCE,
  THINKING_UNCLOSED_REGEX_SOURCE,
  REDACTED_THINKING_REGEX_SOURCE,
  THINKING_STRIP_TEST_CASES,
  stripThinkingBlocks,
  stripRedactedThinkingBlocks,
  findThinkingTags,
} from './redactedThinking';
export type { ThinkingTagMatch } from './redactedThinking';

// Re-export the tagged-result type from the worker pool
export type { StripResult } from './workerUtils';

import { stripThinkingBlocks } from './redactedThinking';
import type { StripResult } from './workerUtils';

/**
 * Strips thinking blocks from content using the persistent
 * Web Worker pool. Falls back to synchronous implementation if the
 * pool is unavailable.
 * @param content The content to process.
 * @returns A tagged result with the processed content and the method used.
 */
export async function stripThinkingBlocksAsync(content: string): Promise<StripResult> {
  try {
    const { stripThinkingBlocksWorker } = await import('./workerUtils');
    return await stripThinkingBlocksWorker(content);
  } catch (error) {
    console.warn('Web Worker failed, falling back to synchronous stripThinkingBlocks:', error);
    return { content: stripThinkingBlocks(content), method: 'sync' };
  }
}

/** @deprecated Use stripThinkingBlocksAsync instead. */
export async function stripRedactedThinkingBlocksAsync(content: string): Promise<StripResult> {
  return stripThinkingBlocksAsync(content);
}

export const ModelValidationSchema = z.object({
  isValid: z.boolean(),
  modelName: z.string(),
  details: OllamaModelDetailsSchema.nullish(),
});

export type ModelValidation = z.infer<typeof ModelValidationSchema>;

export const OllamaHealthIpcSchema = z.object({
  isRunning: z.boolean(),
  version: z.string().nullish(),
  responseTimeMs: z.coerce.number(),
});

export type OllamaHealthIpc = z.infer<typeof OllamaHealthIpcSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  images: z.array(z.string()).nullish(),
  timestamp: z.number(),
  model: z.string().nullish(),
  done: z.boolean().nullish(),
  requestId: z.string().nullish(),
  evalCount: z.number().nullish(),
  evalDuration: z.number().nullish(),
  totalDuration: z.number().nullish(),
  ragSources: z
    .array(
      z.object({
        filePath: z.string(),
        startLine: z.number(),
        endLine: z.number(),
        language: z.string().nullish(),
      })
    )
    .nullish(),
});

export type Message = z.infer<typeof MessageSchema>;

export type Language = 'en' | 'ar';
export type Theme = 'light' | 'dark' | 'system';

export const ChatSettingsSchema = z.object({
  temperature: z.number(),
  top_k: z.number(),
  top_p: z.number(),
  num_predict: z.number(),
  num_ctx: z.number(),
  stop: z.array(z.string()),
  systemPrompt: z.string(),
  ollamaUrl: z.string(),
  language: z.enum(['en', 'ar']),
  theme: z.enum(['light', 'dark', 'system']),
  hasDetectedLanguage: z.boolean(),
  enterToSend: z.boolean().default(true),
  chatRetentionDays: z.number().default(0),
  enableLatex: z.boolean().default(false),
  enableMermaid: z.boolean().default(true),
  density: z.number().default(1.0),
});

export type ChatSettings = z.infer<typeof ChatSettingsSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(MessageSchema),
  model: z.string(),
  settings: ChatSettingsSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Conversation = z.infer<typeof ConversationSchema>;

export const DEFAULT_SETTINGS: ChatSettings = {
  temperature: 0.7,
  top_k: 40,
  top_p: 0.9,
  num_predict: 2048,
  num_ctx: 4096,
  stop: [],
  systemPrompt: '',
  ollamaUrl: 'http://localhost:11434',
  language: 'en',
  theme: 'system',
  hasDetectedLanguage: false,
  enterToSend: true,
  chatRetentionDays: 0,
  enableLatex: false,
  enableMermaid: true,
  density: 1.0,
};

// ====================== RAG TYPES ======================

export const ProjectStatusSchema = z.enum(['idle', 'indexing', 'ready', 'error']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const IndexPhaseSchema = z.enum([
  'discoveringFiles',
  'diffingFiles',
  'deletingStale',
  'readingFiles',
  'chunkingFiles',
  'embeddingChunks',
  'storingChunks',
  'completed',
  'failed',
]);
export type IndexPhase = z.infer<typeof IndexPhaseSchema>;

export const RagProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  embeddingModel: z.string(),
  ignorePatterns: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  indexedAt: z.string().nullable(),
  fileCount: z.number(),
  chunkCount: z.number(),
  totalBytes: z.number(),
  status: ProjectStatusSchema,
});
export type RagProject = z.infer<typeof RagProjectSchema>;

export const IndexProgressSchema = z.object({
  projectId: z.string(),
  phase: IndexPhaseSchema,
  current: z.number(),
  total: z.number(),
  message: z.string(),
});
export type IndexProgress = z.infer<typeof IndexProgressSchema>;

export const SearchResultSchema = z.object({
  chunkId: z.number(),
  content: z.string(),
  chunkType: z.string(),
  language: z.string().nullable(),
  startLine: z.number(),
  endLine: z.number(),
  filePath: z.string(),
  score: z.number(),
  metadata: z.record(z.string(), z.unknown()),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const ProjectStatsSchema = z.object({
  fileCount: z.number(),
  chunkCount: z.number(),
  totalBytes: z.number(),
  embeddingDimension: z.number(),
  indexSizeBytes: z.number(),
  lastIndexed: z.string().nullable(),
});
export type ProjectStats = z.infer<typeof ProjectStatsSchema>;

export const ChunkRecordSchema = z.object({
  id: z.number(),
  chunkIndex: z.number(),
  content: z.string(),
  chunkType: z.string(),
  language: z.string().nullable(),
  startLine: z.number(),
  endLine: z.number(),
  metadata: z.record(z.string(), z.unknown()),
});
export type ChunkRecord = z.infer<typeof ChunkRecordSchema>;

export const IndexCompleteSchema = z.object({
  projectId: z.string(),
  indexedAt: z.string(),
  fileCount: z.number(),
  chunkCount: z.number(),
  totalBytes: z.number(),
});
export type IndexComplete = z.infer<typeof IndexCompleteSchema>;

export const IndexErrorSchema = z.object({
  projectId: z.string(),
  message: z.string(),
});
export type IndexError = z.infer<typeof IndexErrorSchema>;

export const IndexStatusSchema = z.object({
  projectId: z.string(),
  isIndexing: z.boolean(),
  progress: IndexProgressSchema.nullable(),
});
export type IndexStatus = z.infer<typeof IndexStatusSchema>;

export const RagModelValidationSchema = z.object({
  isValid: z.boolean(),
  modelName: z.string(),
  embeddingDimension: z.number().nullable(),
  error: z.string().nullable(),
});
export type RagModelValidation = z.infer<typeof RagModelValidationSchema>;

// ====================== RAG CONTEXT ASSEMBLY ======================

export const CitationSchema = z.object({
  filePath: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  language: z.string().nullable(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const AssembledContextSchema = z.object({
  assembledContext: z.string(),
  citations: z.array(CitationSchema),
  tokenCount: z.number(),
});
export type AssembledContext = z.infer<typeof AssembledContextSchema>;

// RAG validation limits are now in validation-limits.ts, re-exported above.

// ====================== IPC VERSIONING ======================

/** Current global IPC protocol version. Increment on breaking changes. */
export const IPC_VERSION = 1;

/** Mapping of Tauri command names to their contract version.
 * When a breaking change occurs, create a new command (e.g., cmd_foo@v2)
 * and add it here while keeping the old version until migration completes.
 */
export const COMMAND_VERSIONS = {
  // Ollama
  cmd_ollama_get_models: 1,
  cmd_ollama_chat: 1,
  cmd_ollama_abort_chat: 1,
  cmd_ollama_delete_model: 1,
  cmd_ollama_pull_model: 1,
  cmd_ollama_check_health: 1,
  cmd_ollama_verify_service: 1,
  cmd_ollama_generate_title: 1,
  cmd_ollama_validate_model: 1,

  // Logging
  cmd_logs_append: 1,
  cmd_logs_request_clear_token: 1,
  cmd_logs_clear: 1,

  // Tracing
  cmd_trace_append: 1,
  cmd_trace_start: 1,
  cmd_trace_complete: 1,
  cmd_trace_get_context: 1,

  // RAG
  cmd_rag_add_project: 1,
  cmd_rag_remove_project: 1,
  cmd_rag_update_project: 1,
  cmd_rag_list_projects: 1,
  cmd_rag_get_project: 1,
  cmd_rag_index_project: 1,
  cmd_rag_abort_index: 1,
  cmd_rag_reindex_project: 1,
  cmd_rag_get_index_status: 1,
  cmd_rag_search: 1,
  cmd_rag_get_file_chunks: 1,
  cmd_rag_get_project_stats: 1,
  cmd_rag_set_embedding_model: 1,
  cmd_rag_validate_embedding_model: 1,
  cmd_rag_assemble_context: 1,

  // Dialog
  cmd_dialog_ask: 1,

  // Export
  cmd_export_markdown: 1,

  // Opener
  cmd_opener_open_url: 1,

  // Conversations
  cmd_conversations_list: 1,
  cmd_conversation_get: 1,
  cmd_conversation_create: 1,
  cmd_message_append: 1,
  cmd_conversation_delete: 1,
  cmd_conversations_clear: 1,
  cmd_conversation_update: 1,
} as const;

export type CommandName = keyof typeof COMMAND_VERSIONS;
