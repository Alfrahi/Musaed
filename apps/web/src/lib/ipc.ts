import { z } from 'zod';
import type { StoreOptions as StoreOptionsFull } from '@tauri-apps/plugin-store';
import {
  type ApiResponse,
  type OllamaModel,
  type ChatMessage,
  type ChatOptions,
  type OllamaHealth,
  OllamaModelSchema,
  OllamaHealthSchema,
  type ModelValidation,
  ModelValidationSchema,
  ModelNameSchema,
  RequestIdSchema,
  LanguageSchema,
  IpcChatMessageSchema,
  ChatOptionsSchema,
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
  MessageSchema,
  type CommandName,
  AssembledContextSchema,
  type Conversation,
  type Message,
  ConversationSchema,
  // Structured logging types
  TraceEntryInputSchema,
  TraceContextSchema,
  type TraceEntryInput,
  type TraceContext,
  type TraceStatus,
  IPC_LATENCY_BUDGETS,
  type IpcCallStat,
  type IpcStats,
  // Migration contracts
  RunMigrationsRequestSchema,
  RunMigrationsResponseSchema,
  MigrationStatusSchema,
  MigrationInfoSchema,
  type RunMigrationsResponse,
  type MigrationStatus,
  type MigrationInfo,
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
import { translate, getActiveLanguage } from '@/lib/i18n';
import { config } from '@/lib/config';

/**
 * Re-export of the latency budgets from `@musaed/contracts`.
 *
 * The single source of truth lives in `packages/contracts/src/latency.ts` so
 * that command-enum consumers (e.g., feature manifests, diagnostics UI, CI
 * budget checks) can read the same map.
 *
 * @see STANDARDS.md §15 Performance Rules — IPC latency budgets per feature
 */
export { IPC_LATENCY_BUDGETS };
export type { IpcCallStat, IpcStats };

export type { IpcStats as LatencyStats };

/**
 * Aggregated IPC performance statistics for monitoring and CI enforcement.
 * Exposed globally so tests and observability tooling can assert on budget compliance.
 *
 * @example
 * // In a test after performing IPC calls:
 * expect(ipcStats.violationCount).toBe(0);
 * // Or check specific commands:
 * const violations = ipcStats.calls.filter(c => c.status === 'violation');
 * expect(violations).toHaveLength(0);
 */
export const ipcStats: IpcStats = {
  /** Total IPC calls made */
  callCount: 0,

  /** Total IPC calls that exceeded their latency budget */
  violationCount: 0,

  /** Per-call records: command → { latencyMs, budgetMs, status }.
   *  Useful for debugging and per-command analytics. */
  calls: [],
};

/**
 * Maximum number of violation entries retained in `ipcViolationHistory`.
 * Prevents unbounded growth in long-running sessions.
 */
const IPC_VIOLATION_HISTORY_MAX = 200;

/**
 * Throttle window (ms) for trace emission per over-budget command.
 * Once a violation is dispatched, subsequent violations of the same
 * command within this window are dropped to avoid trace-store spam.
 */
const IPC_VIOLATION_TRACE_THROTTLE_MS = 30_000;

/**
 * Structured record of an IPC latency violation that was dispatched
 * to the trace pipeline. The `traceId` matches the value written to
 * the trace store so the Diagnostics UI can correlate the entry in
 * `LogViewer` with the in-process `ipcStats` counter.
 */
export interface IpcViolationRecord {
  /** UUID identifying this violation trace (matches trace store entry). */
  traceId: string;
  /** ISO timestamp at moment of detection. */
  timestamp: string;
  /** Command name that overran its budget. */
  command: string;
  /** Observed latency in milliseconds. */
  latencyMs: number;
  /** Configured budget in milliseconds. */
  budgetMs: number;
  /** Percentage overage (rounded). */
  overagePct: number;
}

/**
 * Rolling window of structured IPC violations. Surfaced to the
 * Diagnostics UI via `getIpcViolations()` and `getIpcViolationsSince()`
 * so users can correlate trace entries with IPC perf counters.
 */
const ipcViolationHistory: IpcViolationRecord[] = [];

/**
 * Last dispatch timestamp (ms) per command, used to enforce the
 * per-command throttle window for trace emission.
 */
const lastViolationTraceAt: Map<string, number> = new Map();

/**
 * Subscribers to mutation of `ipcViolationHistory`. Used by
 * `subscribeIpcViolations()` so long-lived UI surfaces can re-render
 * without polling. Returns an unsubscribe function.
 */
const ipcViolationSubscribers: Set<() => void> = new Set();

function notifyIpcViolationSubscribers(): void {
  for (const subscriber of ipcViolationSubscribers) {
    try {
      subscriber();
    } catch {
      // Subscriber errors must not break the IPC pipeline.
    }
  }
}

/**
 * Generates a UUID v4 for trace IDs. Falls back to a deterministic
 * value in environments without `crypto.randomUUID` (e.g., legacy
 * test runners), keeping the trace pipeline non-fatal.
 */
function generateTraceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ipc-viol-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Dispatches a structured `budget_violation` trace entry through
 * `traceApi.append` so IPC latency violations appear in the same
 * observability pipeline used by other features (STANDARDS.md §14).
 *
 * Throttled per-command at `IPC_VIOLATION_TRACE_THROTTLE_MS` so a
 * persistently over-budget command does not flood the trace store.
 *
 * Returns the dispatched `IpcViolationRecord` when a trace was
 * emitted, or `null` when the violation was suppressed by the
 * throttle window.
 */
function dispatchIpcViolationTrace(
  command: string,
  latencyMs: number,
  budgetMs: number
): IpcViolationRecord | null {
  const now = Date.now();
  const lastAt = lastViolationTraceAt.get(command);
  if (lastAt !== undefined && now - lastAt < IPC_VIOLATION_TRACE_THROTTLE_MS) {
    return null;
  }
  lastViolationTraceAt.set(command, now);

  const traceId = generateTraceId();
  const timestamp = new Date(now).toISOString();
  const overagePct = Math.round(((latencyMs - budgetMs) / budgetMs) * 100);

  const traceInput: TraceEntryInput = {
    traceId,
    feature: 'ipc',
    action: 'budget_violation',
    level: 'WARN',
    status: 'timeout',
    latencyMs,
    message: `[IPC LATENCY VIOLATION] "${command}" took ${latencyMs}ms (budget: ${budgetMs}ms)`,
    source: 'ipc',
    context: {
      command,
      latencyMs,
      budgetMs,
      overagePct,
    },
  };

  traceApi.append(traceInput).catch(() => {
    // Trace emission must never break the IPC pipeline. Errors are
    // silently swallowed in production; the in-process record below
    // still surfaces the violation to the Diagnostics UI.
  });

  const record: IpcViolationRecord = {
    traceId,
    timestamp,
    command,
    latencyMs,
    budgetMs,
    overagePct,
  };

  ipcViolationHistory.push(record);
  if (ipcViolationHistory.length > IPC_VIOLATION_HISTORY_MAX) {
    ipcViolationHistory.shift();
  }
  notifyIpcViolationSubscribers();
  return record;
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    lastViolationTraceAt.clear();
  });
}

/**
 * IPC Bridge — Strict Contract Architecture
 *
 * All Tauri IPC must route through this file. The bridge provides:
 * - Type-safe command dispatch via CommandMap
 * - Input/output validation using Zod schemas
 * - URL security validation for Ollama endpoints
 * - Error sanitization to prevent data leakage
 * - Contract registry guard (COMMAND_VERSIONS) — development-mode check that
 *   every invoked command is registered. Breaking-change detection itself is
 *   delegated to `pnpm validate:contracts --strict`, which cross-checks Rust
 *   #[tauri::command] signatures against this CommandMap at CI time.
 */
export interface CommandMap {
  cmd_ollama_get_models: { args: { baseUrl: string }; return: OllamaModel[] };
  cmd_ollama_chat: {
    args: {
      baseUrl: string;
      model: string;
      messages: ChatMessage[];
      options: ChatOptions;
      requestId: string;
    };
    return: boolean;
  };
  cmd_ollama_abort_chat: { args: { requestId: string }; return: void };
  cmd_ollama_delete_model: { args: { baseUrl: string; name: string }; return: boolean };
  cmd_ollama_pull_model: { args: { baseUrl: string; name: string }; return: void };
  cmd_ollama_abort_pull: { args: { name: string }; return: void };
  cmd_ollama_check_health: { args: { baseUrl: string }; return: OllamaHealth };
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
  cmd_trace_append: { args: { input: TraceEntryInput }; return: void };
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

  // Migration commands — backend SQLite schema migrations. Exposed so the
  // Settings/Diagnostics UI can run, roll back, and report on migrations.
  cmd_run_migrations: {
    args: { target: string; targetVersion?: number; allowRollback: boolean };
    return: RunMigrationsResponse;
  };
  cmd_rollback_migrations: {
    args: { target: string; toVersion: number };
    return: RunMigrationsResponse;
  };
  cmd_get_migration_status: { args: { target: string }; return: MigrationStatus };
  cmd_list_migrations: { args: { target: string }; return: MigrationInfo[] };
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
    options: ChatOptionsSchema,
    requestId: RequestIdSchema,
  }),
  cmd_ollama_abort_chat: z.object({ requestId: RequestIdSchema }),
  cmd_ollama_delete_model: z.object({ baseUrl: z.string(), name: ModelNameSchema }),
  cmd_ollama_pull_model: z.object({ baseUrl: z.string(), name: ModelNameSchema }),
  cmd_ollama_abort_pull: z.object({ name: ModelNameSchema }),
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
  cmd_trace_append: z.object({ input: TraceEntryInputSchema }),
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

  // Migration input schemas
  cmd_run_migrations: RunMigrationsRequestSchema,
  cmd_rollback_migrations: z.object({
    target: z.enum(['conversations', 'rag']),
    toVersion: z.number().int().min(0),
  }),
  cmd_get_migration_status: z.object({
    target: z.enum(['conversations', 'rag']),
  }),
  cmd_list_migrations: z.object({
    target: z.enum(['conversations', 'rag']),
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
  cmd_ollama_abort_pull: voidSchema,
  cmd_ollama_check_health: OllamaHealthSchema,
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

  // Migration return schemas
  cmd_run_migrations: RunMigrationsResponseSchema,
  cmd_rollback_migrations: RunMigrationsResponseSchema,
  cmd_get_migration_status: MigrationStatusSchema,
  cmd_list_migrations: z.array(MigrationInfoSchema),
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
  if (!config.isProd) {
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
      toast.error(translate('error.securityBlock', getActiveLanguage()));
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
        toast.error(
          translate('error.invalidRequest', getActiveLanguage(), { message: safeMessage })
        );
      }
      return null;
    }
  }

  if (!checkIsTauri()) return null;

  const budgetMs = IPC_LATENCY_BUDGETS[command] ?? 0;
  const callStart = performance.now();

  try {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    const response = await tauriInvoke<ApiResponse<CommandMap[K]['return']>>(command, args);

    const schema = CommandReturnSchemas[command];
    const latencyMs = Math.round(performance.now() - callStart);

    if (response?.success) {
      if (!schema) {
        recordIpcLatency(command, latencyMs, budgetMs);
        return response.data ?? true;
      }
      const result = schema.safeParse(response.data);
      if (!result.success) {
        console.error(`[IPC] Response validation failed for "${command}"`, result.error.issues);
        throw new Error('Invalid response from backend');
      }
      recordIpcLatency(command, latencyMs, budgetMs);
      return result.data;
    }

    if (response?.error) {
      recordIpcLatency(command, latencyMs, budgetMs);
      const sanitized = sanitizeError(response.error);
      if (!options?.quiet) {
        toast.error(
          translate('error.backendError', getActiveLanguage(), { message: sanitized.message })
        );
      }
      return null;
    }
    throw new Error('Unknown error occurred during IPC call');
  } catch (err) {
    const latencyMs = Math.round(performance.now() - callStart);
    recordIpcLatency(command, latencyMs, budgetMs);
    const sanitized = sanitizeError(err);
    throw new Error(sanitized.message);
  }
}

/**
 * Records IPC call latency and checks against budget thresholds.
 * Violations are reported as structured WARN entries via logApi.
 * All calls are recorded in ipcStats for monitoring and CI enforcement.
 */
function recordIpcLatency(command: string, latencyMs: number, budgetMs: number): void {
  ipcStats.callCount++;

  const status = budgetMs > 0 && latencyMs > budgetMs ? 'violation' : 'ok';
  ipcStats.calls.push({ command, latencyMs, budgetMs, status });

  if (status === 'violation') {
    ipcStats.violationCount++;
    const dispatched = dispatchIpcViolationTrace(command, latencyMs, budgetMs);
    if (dispatched === null) {
      // Throttled — still emit a dev-only console line so the
      // violation is visible without spamming the trace store.
      if (typeof window === 'undefined') {
        console.warn(
          `[IPC LATENCY VIOLATION] "${command}" took ${latencyMs}ms (budget: ${budgetMs}ms)`
        );
      }
    } else if (typeof window === 'undefined') {
      // In non-window runtimes (e.g., SSR, vitest jsdom without
      // window) mirror the violation to stdout for visibility.
      console.warn(
        `[IPC LATENCY VIOLATION] "${command}" took ${latencyMs}ms (budget: ${budgetMs}ms)`
      );
    }
  }
}

/**
 * Returns a deep copy snapshot of the current IPC stats. Useful for
 * long-lived subscribers (e.g. Diagnostics UI) that want to re-render
 * without mutating the live counters.
 */
export function snapshotIpcStats(): IpcStats {
  return {
    callCount: ipcStats.callCount,
    violationCount: ipcStats.violationCount,
    calls: [...ipcStats.calls],
  };
}

/**
 * Resets all IPC perf counters. Intended for tests and for the
 * Diagnostics UI's "clear counters" affordance.
 */
export function resetIpcStats(): void {
  ipcStats.callCount = 0;
  ipcStats.violationCount = 0;
  ipcStats.calls.length = 0;
}

/**
 * Clears all IPC latency tracking state: perf counters, violation
 * history, and the per-command throttle window. Used by tests and
 * the Diagnostics UI "clear counters" affordance.
 */
export function resetIpcViolations(): void {
  ipcStats.callCount = 0;
  ipcStats.violationCount = 0;
  ipcStats.calls.length = 0;
  ipcViolationHistory.length = 0;
  lastViolationTraceAt.clear();
  notifyIpcViolationSubscribers();
}

/**
 * Returns a copy of the rolling IPC violation history (most-recent
 * first is not guaranteed — entries are in insertion order). The
 * list is bounded at `IPC_VIOLATION_HISTORY_MAX`.
 */
export function getIpcViolations(): IpcViolationRecord[] {
  return [...ipcViolationHistory];
}

/**
 * Returns violations whose `traceId` differs from the supplied
 * marker — i.e., entries that arrived *after* the marker. Pass the
 * last-seen `traceId` from a prior call to obtain an incremental
 * update. Returns the full history when the marker is not found.
 *
 * The Diagnostics UI uses this to re-render only when new violations
 * arrive, avoiding polling churn.
 */
export function getIpcViolationsSince(traceId: string): IpcViolationRecord[] {
  const idx = ipcViolationHistory.findIndex((entry) => entry.traceId === traceId);
  if (idx === -1) return [...ipcViolationHistory];
  return ipcViolationHistory.slice(idx + 1);
}

/**
 * Subscribes to mutation of the IPC violation history. Returns an
 * unsubscribe function. Long-lived UI surfaces (LogViewer,
 * DiagnosticsSettings) use this to re-render without polling.
 */
export function subscribeIpcViolations(listener: () => void): () => void {
  ipcViolationSubscribers.add(listener);
  return () => {
    ipcViolationSubscribers.delete(listener);
  };
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
   * Cancels an in-progress model pull. Backend short-circuits to success
   * when no active pull exists for the given model name.
   * @param name - Name of the model whose pull should be aborted
   */
  abortPull: (name: string) => callInternal('cmd_ollama_abort_pull', { name }),
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
 * Implements the observability model from STANDARDS.md §14.
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

/**
 * Migration API — drives backend SQLite schema migrations (conversations/rag).
 *
 * Used by the Settings/Diagnostics surface to run pending migrations, roll
 * back to a previous version, and report current state. These are the typed
 * equivalents of the four `cmd_*_migrations` Rust commands.
 */
export const migrationApi = {
  /**
   * Runs pending migrations for a target database.
   * @param args - { target, targetVersion?, allowRollback? }
   * @returns Migration result with from/to version and applied steps
   */
  run: (args: CommandMap['cmd_run_migrations']['args']) => callInternal('cmd_run_migrations', args),
  /**
   * Rolls back a target database to a previous version.
   * @param target - 'conversations' | 'rag'
   * @param toVersion - Target version to roll back to
   * @returns Migration result with from/to version and applied steps
   */
  rollback: (target: 'conversations' | 'rag', toVersion: number) =>
    callInternal('cmd_rollback_migrations', { target, toVersion }),
  /**
   * Reports current vs latest version for a target database.
   * @param target - 'conversations' | 'rag'
   * @returns Migration status including `needsMigration` flag
   */
  status: (target: 'conversations' | 'rag') => callInternal('cmd_get_migration_status', { target }),
  /**
   * Lists the available migration steps for a target database.
   * @param target - 'conversations' | 'rag'
   * @returns Array of migration info (version, description, isRollbackable)
   */
  list: (target: 'conversations' | 'rag') => callInternal('cmd_list_migrations', { target }),
};
