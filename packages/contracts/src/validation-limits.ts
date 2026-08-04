/**
 * SINGLE SOURCE OF TRUTH for all validation constants shared between
 * TypeScript (Zod schemas) and Rust (validation modules).
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ DO NOT duplicate these values in Rust or TS — always derive    │
 * │ from this file. Rust constants are generated via                │
 * │ `pnpm codegen:validation`.                                      │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * When adding a new constant:
 *   1. Add it here with a descriptive comment.
 *   2. Run `pnpm codegen:validation` to regenerate the Rust file.
 *   3. Commit both this file and the generated Rust file.
 */

// ====================== CHAT / OLLAMA LIMITS ======================

/** Maximum length for model / name strings (e.g. "llama3:latest"). */
export const MAX_MODEL_NAME_LEN = 128;

/** Maximum length for a request ID. */
export const MAX_REQUEST_ID_LEN = 128;

/** Maximum length for a single message's content field (64 KiB). */
export const MAX_MESSAGE_CONTENT_LEN = 64 * 1024;

/** Maximum number of messages in a single chat request. */
export const MAX_MESSAGES_COUNT = 1000;

/** Maximum number of base64-encoded images per single message. */
export const MAX_IMAGES_PER_MESSAGE = 10;

/** Maximum length for a single base64-encoded image string (10 MiB). */
export const MAX_IMAGE_B64_LEN = 10 * 1024 * 1024;

/** Maximum length for a log entry string (10 KiB). */
export const MAX_LOG_ENTRY_LEN = 10 * 1024;

/** Maximum length for a log-clear confirmation token (UUID v4 = 36 chars). */
export const MAX_LOG_CLEAR_TOKEN_LEN = 64;

/** Maximum length for user/assistant message fragments sent to title generation (10 KiB). */
export const MAX_TITLE_INPUT_LEN = 10 * 1024;

/** Maximum length for a role string. */
export const MAX_ROLE_LEN = 32;

// ====================== STRUCTURED LOGGING LIMITS ======================

/** Maximum length for a feature name in structured logging. */
export const MAX_FEATURE_NAME_LEN = 64;

/** Maximum length for an action name in structured logging. */
export const MAX_ACTION_NAME_LEN = 128;

/** Maximum length for a trace context message. */
export const MAX_TRACE_MESSAGE_LEN = 10 * 1024;

/** Maximum number of context fields in a trace entry. */
export const MAX_TRACE_CONTEXT_FIELDS = 50;

/** Maximum length of a single context field value. */
export const MAX_TRACE_CONTEXT_VALUE_LEN = 2048;

/** Allowed range for temperature: [min, max]. */
export const TEMPERATURE_RANGE = [0, 2] as const;

/** Allowed range for top_k: [min, max]. */
export const TOP_K_RANGE = [1, 200] as const;

/** Allowed range for top_p: [min, max]. */
export const TOP_P_RANGE = [0, 1] as const;

/** Allowed range for num_predict: [min, max]. */
export const NUM_PREDICT_RANGE = [1, 32768] as const;

/** Allowed range for num_ctx: [min, max]. */
export const NUM_CTX_RANGE = [1, 131072] as const;

/** Maximum number of stop sequences. */
export const MAX_STOP_SEQUENCES = 10;

/** Maximum length of a single stop sequence string. */
export const MAX_STOP_SEQUENCE_LEN = 256;

// ====================== ALLOWED VALUES ======================

/** Valid role strings accepted by the chat endpoint. */
export const VALID_ROLES = ['system', 'user', 'assistant'] as const;

/** Valid language codes for title generation. */
export const VALID_LANGUAGES = ['en', 'ar'] as const;

// ====================== RAG LIMITS ======================

/** Maximum length for a RAG project name. */
export const MAX_PROJECT_NAME_LEN = 256;

/** Maximum length for a RAG project path. */
export const MAX_PROJECT_PATH_LEN = 4096;

/** Maximum number of ignore patterns per project. */
export const MAX_IGNORE_PATTERNS = 100;

/** Maximum length of a single ignore pattern. */
export const MAX_IGNORE_PATTERN_LEN = 512;

/** Maximum length for a RAG search query (10 KiB). */
export const MAX_SEARCH_QUERY_LEN = 10 * 1024;

/** Maximum topK value for RAG search. */
export const MAX_TOP_K = 50;

/** Minimum topK value for RAG search. */
export const MIN_TOP_K = 1;

/** Maximum threshold value for RAG search. */
export const MAX_THRESHOLD = 1.0;

/** Minimum threshold value for RAG search. */
export const MIN_THRESHOLD = 0.0;

/** Maximum number of file chunks per query. */
export const MAX_FILE_CHUNKS_QUERY = 100;

/** Maximum length for a file path in chunk queries. */
export const MAX_FILE_PATH_LEN = 4096;

/** Default maximum character budget for assembled RAG context. */
export const MAX_RAG_CONTEXT_CHARS = 20_000;

// ====================== CONVENIENCE GROUPINGS ======================
// These objects re-export the flat constants above so existing consumers
// that reference `VALIDATION_LIMITS.X` or `RAG_VALIDATION_LIMITS.X`
// continue to work without changes.

/** Grouped chat/ollama validation limits (mirrors Rust `validation` module). */
export const VALIDATION_LIMITS = {
  MAX_MODEL_NAME_LEN,
  MAX_REQUEST_ID_LEN,
  MAX_MESSAGE_CONTENT_LEN,
  MAX_MESSAGES_COUNT,
  MAX_IMAGES_PER_MESSAGE,
  MAX_IMAGE_B64_LEN,
  MAX_LOG_ENTRY_LEN,
  MAX_LOG_CLEAR_TOKEN_LEN,
  MAX_TITLE_INPUT_LEN,
  MAX_ROLE_LEN,
  // Structured logging
  MAX_FEATURE_NAME_LEN,
  MAX_ACTION_NAME_LEN,
  MAX_TRACE_MESSAGE_LEN,
  MAX_TRACE_CONTEXT_FIELDS,
  MAX_TRACE_CONTEXT_VALUE_LEN,
  TEMPERATURE_RANGE,
  TOP_K_RANGE,
  TOP_P_RANGE,
  NUM_PREDICT_RANGE,
  NUM_CTX_RANGE,
  MAX_STOP_SEQUENCES,
  MAX_STOP_SEQUENCE_LEN,
} as const;

/** Grouped RAG validation limits (mirrors Rust `rag::validation` module). */
export const RAG_VALIDATION_LIMITS = {
  MAX_PROJECT_NAME_LEN,
  MAX_PROJECT_PATH_LEN,
  MAX_IGNORE_PATTERNS,
  MAX_IGNORE_PATTERN_LEN,
  MAX_SEARCH_QUERY_LEN,
  MAX_TOP_K,
  MIN_TOP_K,
  MAX_THRESHOLD,
  MIN_THRESHOLD,
  MAX_FILE_CHUNKS_QUERY,
  MAX_FILE_PATH_LEN,
  MAX_RAG_CONTEXT_CHARS,
} as const;
