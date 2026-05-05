'use client';

import { z } from 'zod';

export enum BackendErrorCode {
  NetworkError = 'NETWORK_ERROR',
  OllamaUnavailable = 'OLLAMA_UNAVAILABLE',
  ModelNotFound = 'MODEL_NOT_FOUND',
  InvalidRequest = 'INVALID_REQUEST',
  FileSystemError = 'FILE_SYSTEM_ERROR',
  InternalError = 'INTERNAL_ERROR',
  Aborted = 'ABORTED',
  Unknown = 'UNKNOWN',
}

export const BackendErrorSchema = z
  .object({
    code: z.string().default(BackendErrorCode.Unknown),
    message: z.string(),
    requestId: z.string().nullish(),
  })
  .transform((data) => ({
    ...data,
    requestId: data.requestId,
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

  // Step 1: Redact filesystem paths (Unix and Windows)
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

  // Step 2: Redact sensitive URLs while preserving localhost for debugging
  const urlRegex = /(https?:\/\/(?!localhost|127\.0\.0\.1|::1)[^\s<>"{}|\\^`\[\]]+)/gi;
  message = message.replace(urlRegex, '[URL REDACTED]');

  // Step 3: Remove common sensitive patterns
  const sensitivePatterns: Array<[RegExp, string]> = [
    // API keys/tokens
    [/(api[_-]?key|token|secret|password|passwd|pwd)[=:]\s*["']?[\w-]{8,}["']?/gi, '$1=[REDACTED]'],
    // Private IPs (but keep localhost)
    [
      /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}(?::\d+)?/g,
      '[PRIVATE IP REDACTED]',
    ],
    // Database connection strings
    [/(mongodb|postgres|mysql|redis):\/\/[^\s]+/gi, '[CONNECTION STRING REDACTED]'],
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

  // Step 4: Normalize whitespace and trim
  message = message.replace(/\s+/g, ' ').trim();

  // Step 5: Fallback for completely empty messages
  if (!message || message.length < 2) {
    message = 'An error occurred. Please try again.';
  }

  return {
    code,
    message,
    requestId,
  };
};

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: BackendError;
}

// ====================== IPC INPUT VALIDATION ======================

/** Validation constants mirroring the Rust backend limits. */
export const VALIDATION_LIMITS = {
  MAX_MODEL_NAME_LEN: 128,
  MAX_REQUEST_ID_LEN: 128,
  MAX_MESSAGE_CONTENT_LEN: 50 * 1024,
  MAX_MESSAGES_COUNT: 1000,
  MAX_IMAGES_PER_MESSAGE: 10,
  MAX_IMAGE_B64_LEN: 10 * 1024 * 1024,
  MAX_LOG_ENTRY_LEN: 10 * 1024,
  MAX_TITLE_INPUT_LEN: 10 * 1024,
  MAX_ROLE_LEN: 32,
  TEMPERATURE_RANGE: [0, 2] as const,
  TOP_K_RANGE: [1, 200] as const,
  TOP_P_RANGE: [0, 1] as const,
  NUM_PREDICT_RANGE: [1, 32768] as const,
  NUM_CTX_RANGE: [1, 131072] as const,
  MAX_STOP_SEQUENCES: 10,
  MAX_STOP_SEQUENCE_LEN: 256,
} as const;

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

export const OllamaModelDetailsSchema = z.object({
  format: z.string().nullish(),
  family: z.string().nullish(),
  parameter_size: z.string().nullish(),
  quantization_level: z.string().nullish(),
});

export const OllamaModelSchema = z.object({
  name: z.string(),
  size: z.number().nullish(),
  digest: z.string().nullish(),
  details: OllamaModelDetailsSchema.nullish(),
});

export type OllamaModel = z.infer<typeof OllamaModelSchema>;

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
  total_duration: z.number().nullish(),
  load_duration: z.number().nullish(),
  prompt_eval_count: z.number().nullish(),
  eval_count: z.number().nullish(),
  eval_duration: z.number().nullish(),
  requestId: z.string().nullish(),
});

export type OllamaToken = z.infer<typeof OllamaTokenSchema>;

export const PullProgressSchema = z.object({
  status: z.string(),
  completed: z.number().nullish(),
  total: z.number().nullish(),
  name: z.string().nullish(),
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
  THINKING_REGEX_SOURCE,
  REDACTED_THINKING_REGEX_SOURCE,
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
  images: z.array(z.string()).optional(),
  timestamp: z.number(),
  model: z.string().optional(),
  done: z.boolean().optional(),
  requestId: z.string().optional(),
  eval_count: z.number().optional(),
  eval_duration: z.number().optional(),
  total_duration: z.number().optional(),
  ragSources: z
    .array(
      z.object({
        filePath: z.string(),
        startLine: z.number(),
        endLine: z.number(),
        language: z.string().optional(),
      })
    )
    .optional(),
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
  enableLatex: z.boolean().default(true),
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
  enableLatex: true,
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

// RAG-specific validation limits
export const RAG_VALIDATION_LIMITS = {
  MAX_PROJECT_NAME_LEN: 256,
  MAX_PROJECT_PATH_LEN: 4096,
  MAX_IGNORE_PATTERNS: 100,
  MAX_IGNORE_PATTERN_LEN: 512,
  MAX_SEARCH_QUERY_LEN: 10 * 1024, // 10 KiB
  MAX_TOP_K: 50,
  MIN_TOP_K: 1,
  MAX_THRESHOLD: 1.0,
  MIN_THRESHOLD: 0.0,
  MAX_FILE_CHUNKS_QUERY: 100,
} as const;
