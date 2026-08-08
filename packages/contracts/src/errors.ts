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
  ValidationError = 'VALIDATION_ERROR',

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
  RagIndexError = 'RAG_INDEX_ERROR',

  // ── Conversation ──────────────────────────────────────
  ConversationNotFound = 'CONVERSATION_NOT_FOUND',
  ConversationFetchError = 'CONVERSATION_FETCH_ERROR',
  ConversationListError = 'CONVERSATION_LIST_ERROR',
  ConversationCreateError = 'CONVERSATION_CREATE_ERROR',
  ConversationDeleteError = 'CONVERSATION_DELETE_ERROR',
  ConversationUpdateError = 'CONVERSATION_UPDATE_ERROR',
  MessageAppendError = 'MESSAGE_APPEND_ERROR',
  MessageDeleteError = 'MESSAGE_DELETE_ERROR',
  ConversationLockError = 'CONVERSATION_LOCK_ERROR',

  // ── Dialog ────────────────────────────────────────────
  DialogError = 'DIALOG_ERROR',

  // ── Context menu ──────────────────────────────────────
  ContextMenuError = 'CONTEXT_MENU_ERROR',

  // ── System tray ───────────────────────────────────────
  TrayError = 'TRAY_ERROR',

  // ── URL Opener ────────────────────────────────────────
  UrlBlocked = 'URL_BLOCKED',
  OpenUrlError = 'OPEN_URL_ERROR',

  // ── Export ────────────────────────────────────────────
  ExportError = 'EXPORT_ERROR',

  // ── Migration ─────────────────────────────────────────
  MigrationError = 'MIGRATION_ERROR',

  // ── Generic ───────────────────────────────────────────
  InternalError = 'INTERNAL_ERROR',
  Aborted = 'ABORTED',
  Unknown = 'UNKNOWN',
}

/** Set of all valid error code strings for CI validation. */
export const BACKEND_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.values(BackendErrorCode) as string[]
);

export const BackendErrorSchema = z.object({
  code: z.string().default(BackendErrorCode.Unknown),
  message: z.string(),
  requestId: z.string().nullish(),
  context: z.string().nullish(),
  isRetryable: z.boolean().default(false),
});

export type BackendError = z.infer<typeof BackendErrorSchema>;

/**
 * Typed IPC error thrown by the IPC bridge when a backend call fails.
 *
 * Carries the structured fields from `BackendError` (`code`, `context`,
 * `isRetryable`, `requestId`) through to JS `catch` sites, so callers can
 * branch on retryability or error code instead of parsing `error.message`.
 *
 * Replaces the prior `throw new Error(sanitized.message)` in `callInternal`
 * which discarded everything but the message string.
 */
export class IpcError extends Error {
  readonly code: BackendErrorCode;
  readonly isRetryable: boolean;
  readonly context?: string;
  readonly requestId?: string;

  constructor(backend: BackendError) {
    super(backend.message);
    this.name = 'IpcError';
    // `BackendErrorSchema.code` is typed as `string` (Zod defaults widen
    // string-literal unions); narrow to `BackendErrorCode` here so callers
    // can branch on the enum.
    this.code = backend.code as BackendErrorCode;
    this.isRetryable = backend.isRetryable;
    // `nullish()` yields `string | null | undefined`; collapse `null` to
    // `undefined` so the class fields remain `string | undefined`.
    this.context = backend.context ?? undefined;
    this.requestId = backend.requestId ?? undefined;

    // Restore prototype chain when transpiled to ES5 — without this,
    // `instanceof IpcError` returns false after downlevel compilation.
    Object.setPrototypeOf(this, IpcError.prototype);
  }
}
