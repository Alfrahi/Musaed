import { z } from 'zod';
import {
  type ApiResponse,
  OllamaModelSchema,
  OllamaHealthSchema,
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
  ChunkRecordSchema,
  FileRecordSchema,
  RAG_VALIDATION_LIMITS,
  MAX_FILE_PATH_LEN,
  sanitizeError,
  IpcError,
  BackendErrorCode,
  COMMAND_VERSIONS,
  MessageSchema,
  type CommandName,
  type CommandMap,
  AssembledContextSchema,
  ConversationSchema,
  MessageSearchResultSchema,
  // Structured logging types
  TraceEntryInputSchema,
  TraceContextSchema,
  type TraceEntryInput,
  IPC_LATENCY_BUDGETS,
  type IpcCallStat,
  type IpcStats,
  // Migration contracts
  RunMigrationsRequestSchema,
  RunMigrationsResponseSchema,
  MigrationStatusSchema,
  MigrationInfoSchema,
  // Context menu contracts
  ContextMenuKindSchema,
  ContextMenuResponseSchema,
  ContextMenuLabelsSchema,
  // System tray contracts
  BackgroundTasksResponseSchema,
  MenuBarLabelsSchema,
  // Metrics contracts
  MetricsSnapshotSchema,
  // Dialog contracts
  DialogKindSchema,
} from '@musaed/contracts';
import toast from 'react-hot-toast';
import { translate, getActiveLanguage } from '@/lib/i18n';
import { config } from '@/lib/config';
import { isValidOllamaUrl, sanitizeOllamaUrl } from '@/lib/url-allowlist';
import { generateTraceId } from '@/lib/trace-id';
import { checkIsTauri } from '@/lib/tauri-detection';
import {
  ipcStats,
  IPC_VIOLATION_HISTORY_MAX,
  IPC_VIOLATION_TRACE_THROTTLE_MS,
  IPC_CALLS_HISTORY_MAX,
  ipcViolationHistory,
  lastViolationTraceAt,
  notifyIpcViolationSubscribers,
  snapshotIpcStats,
  resetIpcStats,
  resetIpcViolations,
  getIpcViolations,
  getIpcViolationsSince,
  subscribeIpcViolations,
  type IpcViolationRecord,
} from '@/lib/ipc-latency';

// Re-export for backward compatibility
export { isValidOllamaUrl, sanitizeOllamaUrl };
export { checkIsTauri };
export type { CommandMap };
export {
  ipcStats,
  snapshotIpcStats,
  resetIpcStats,
  resetIpcViolations,
  getIpcViolations,
  getIpcViolationsSince,
  subscribeIpcViolations,
  type IpcViolationRecord,
};

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

  // Call cmd_trace_append directly (not via traceApi) to avoid a circular
  // import between transport.ts and trace.ts — trace.ts is built on this file.
  callInternal('cmd_trace_append', { input: traceInput }).catch(() => {
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
 *   #[tauri::command] signatures against the CommandMap declared in
 *   `packages/contracts/src/command-versions.ts` at CI time.
 */

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
  cmd_ollama_validate_model: z.object({ baseUrl: z.string(), name: ModelNameSchema }),
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
    kind: DialogKindSchema.optional(),
  }),

  // Opener command input schemas
  cmd_opener_open_url: z.object({
    url: z.string().min(1).max(VALIDATION_LIMITS.MAX_MESSAGE_CONTENT_LEN),
  }),

  // File dialog command input schemas
  cmd_dialog_open_file: z.object({
    filters: z
      .array(
        z.object({
          name: z.string().min(1),
          extensions: z.array(z.string().min(1)),
        })
      )
      .optional(),
    multiple: z.boolean().optional(),
    directory: z.boolean().optional(),
    defaultPath: z.string().optional(),
  }),
  cmd_dialog_save_file: z.object({
    filters: z
      .array(
        z.object({
          name: z.string().min(1),
          extensions: z.array(z.string().min(1)),
        })
      )
      .optional(),
    defaultPath: z.string().optional(),
  }),

  // Store command input schemas
  cmd_store_load: z.object({
    file: z.string().min(1).max(VALIDATION_LIMITS.MAX_STORE_FILENAME_LEN),
  }),
  cmd_store_get: z.object({
    file: z.string().min(1).max(VALIDATION_LIMITS.MAX_STORE_FILENAME_LEN),
    key: z.string().min(1).max(VALIDATION_LIMITS.MAX_STORE_KEY_LEN),
  }),
  cmd_store_set: z.object({
    file: z.string().min(1).max(VALIDATION_LIMITS.MAX_STORE_FILENAME_LEN),
    key: z.string().min(1).max(VALIDATION_LIMITS.MAX_STORE_KEY_LEN),
    // Cap the serialized size of the value, not just its shape, so a
    // compromised frontend can't flood the key-value store with huge blobs.
    value: z
      .unknown()
      .refine(
        (v) => JSON.stringify(v)?.length <= VALIDATION_LIMITS.MAX_STORE_VALUE_LEN,
        `value exceeds ${VALIDATION_LIMITS.MAX_STORE_VALUE_LEN} bytes when serialized`
      ),
  }),
  cmd_store_save: z.object({
    file: z.string().min(1).max(VALIDATION_LIMITS.MAX_STORE_FILENAME_LEN),
  }),
  cmd_store_delete: z.object({
    file: z.string().min(1).max(VALIDATION_LIMITS.MAX_STORE_FILENAME_LEN),
    key: z.string().min(1).max(VALIDATION_LIMITS.MAX_STORE_KEY_LEN),
  }),

  // Filesystem command input schemas
  cmd_fs_read_text_file: z.object({
    path: z.string().min(1).max(MAX_FILE_PATH_LEN),
  }),
  cmd_fs_read_file: z.object({
    path: z.string().min(1).max(MAX_FILE_PATH_LEN),
  }),
  cmd_fs_write_text_file: z.object({
    path: z.string().min(1).max(MAX_FILE_PATH_LEN),
    content: z.string().max(RAG_VALIDATION_LIMITS.MAX_FILE_WRITE_LEN),
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
  cmd_rag_list_files: z.object({
    projectId: z.string().min(1),
  }),
  cmd_rag_set_embedding_model: z.object({
    projectId: z.string().min(1),
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
  cmd_message_delete: z.object({
    conversationId: z.string().min(1),
    messageId: z.string().min(1),
  }),
  cmd_conversation_delete: z.object({ id: z.string().min(1) }),
  cmd_conversations_clear: undefined,
  cmd_conversation_update: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    updatedAt: z.number(),
  }),
  cmd_conversation_search: z.object({
    query: z.string().min(1).max(VALIDATION_LIMITS.MAX_SEARCH_QUERY_LEN),
    limit: z.number().int().min(1).max(100),
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

  // Context menu input schema — validates the request from the frontend
  // before it reaches the Rust command adapter. Fields match the Rust
  // `cmd_context_menu_show` signature exactly (kind, labels, x, y).
  cmd_context_menu_show: z.object({
    kind: ContextMenuKindSchema,
    labels: ContextMenuLabelsSchema,
    x: z.number().finite(),
    y: z.number().finite(),
  }),

  // App metadata — no user-facing args; the Rust command reads only the
  // Tauri-injected AppHandle. Return is validated as a non-empty string.
  cmd_get_app_version: undefined,

  // System tray — no user-facing args; reads the three abort-handle maps.
  cmd_tray_get_background_status: undefined,

  // Menu bar — translated labels for the custom menu items.
  cmd_menu_rebuild: z.object({ labels: MenuBarLabelsSchema }),

  // Metrics — no user-facing args; drains in-process latency samples.
  cmd_metrics_snapshot: undefined,
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
  cmd_ollama_validate_model: ModelValidationSchema,
  cmd_ollama_generate_title: z.string(),
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

  // Opener command return schemas
  cmd_opener_open_url: z.boolean(),

  // File dialog command return schemas
  cmd_dialog_open_file: z.array(z.string()).nullable(),
  cmd_dialog_save_file: z.string().nullable(),

  // Store command return schemas
  cmd_store_load: z.boolean(),
  cmd_store_get: z.unknown().nullable(),
  cmd_store_set: z.boolean(),
  cmd_store_save: z.boolean(),
  cmd_store_delete: z.boolean(),

  // Filesystem command return schemas
  cmd_fs_read_text_file: z.string(),
  cmd_fs_read_file: z.string(),
  cmd_fs_write_text_file: z.boolean(),

  // RAG command return schemas
  cmd_rag_add_project: RagProjectSchema,
  cmd_rag_remove_project: z.boolean(),
  cmd_rag_update_project: RagProjectSchema,
  cmd_rag_list_projects: z.array(RagProjectSchema),
  cmd_rag_index_project: z.boolean(),
  cmd_rag_abort_index: z.boolean(),
  cmd_rag_reindex_project: z.boolean(),
  cmd_rag_retry_index_project: z.boolean(),
  cmd_rag_search: z.array(SearchResultSchema),
  cmd_rag_get_file_chunks: z.array(ChunkRecordSchema),
  cmd_rag_list_files: z.array(FileRecordSchema),
  cmd_rag_set_embedding_model: z.boolean(),
  cmd_rag_assemble_context: AssembledContextSchema,
  cmd_conversations_list: z.array(ConversationSchema),
  cmd_conversation_get: ConversationSchema,
  cmd_conversation_create: z.string(),
  cmd_message_append: voidSchema,
  cmd_message_delete: voidSchema,
  cmd_conversation_delete: voidSchema,
  cmd_conversations_clear: voidSchema,
  cmd_conversation_update: voidSchema,
  cmd_conversation_search: z.array(MessageSearchResultSchema),

  // Migration return schemas
  cmd_run_migrations: RunMigrationsResponseSchema,
  cmd_rollback_migrations: RunMigrationsResponseSchema,
  cmd_get_migration_status: MigrationStatusSchema,
  cmd_list_migrations: z.array(MigrationInfoSchema),

  // Context menu return schema
  cmd_context_menu_show: ContextMenuResponseSchema,

  // App metadata return schema — non-empty version string from tauri.conf.json.
  cmd_get_app_version: z.string().min(1),

  // System tray return schema — active background task list + hasActiveTasks flag.
  cmd_tray_get_background_status: BackgroundTasksResponseSchema,

  // Menu bar return schema — boolean success flag.
  cmd_menu_rebuild: z.boolean(),

  // Metrics return schema — rolling latency snapshot.
  cmd_metrics_snapshot: MetricsSnapshotSchema,
};

// ============================================================================
// URL Security — delegated to url-allowlist.ts (Finding 12)
// ============================================================================

const IPC_TIMEOUT_MULTIPLIER = 3;
const IPC_DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Creates a timeout promise for an IPC call using a 3× latency budget cushion.
 * The budget measures *expected* latency (violations are observability); the
 * timeout catches *hung* calls (reliability). Commands without an explicit
 * budget get a generous default so they can't hang forever but aren't killed
 * eagerly.
 */
function createIpcTimeout(command: string, budgetMs: number): Promise<never> {
  const timeoutMs = budgetMs > 0 ? budgetMs * IPC_TIMEOUT_MULTIPLIER : IPC_DEFAULT_TIMEOUT_MS;
  return new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(
        new IpcError({
          code: BackendErrorCode.Timeout,
          message: `IPC call "${command}" timed out after ${timeoutMs}ms`,
          requestId: undefined,
          context: undefined,
          isRetryable: true,
        })
      );
    }, timeoutMs);
  });
}

/**
 * Internal helper to perform typed IPC calls via Tauri.
 * Handles input/output validation, URL security checks, and error sanitization.
 * @param command - The command key from CommandMap
 * @param args - The arguments object for the command
 * @param options - Optional flags (e.g., quiet suppresses toast errors)
 * @returns The validated return value from the Rust backend, or null if call was blocked
 * @throws {Error} If the backend returns an error or validation fails
 */
function invalidResponseError(command: string, raw: unknown): IpcError {
  console.error(`[IPC] Invalid response from "${command}":`, raw);
  return new IpcError({
    code: BackendErrorCode.InvalidResponse,
    message: `Backend returned invalid data for "${command}": ${raw instanceof Error ? raw.message : String(raw)}`,
    requestId: undefined,
    context: undefined,
    isRetryable: false,
  });
}

async function awaitIpcResponse<K extends keyof CommandMap>(
  command: K,
  invokePromise: Promise<ApiResponse<CommandMap[K]['return']>>,
  callStart: number,
  budgetMs: number
): Promise<ApiResponse<CommandMap[K]['return']>> {
  let response: ApiResponse<CommandMap[K]['return']>;
  try {
    response = await Promise.race([invokePromise, createIpcTimeout(command, budgetMs)]);
  } catch (parseErr) {
    // Invoke-layer rejections (backend argument errors, transport failures)
    // are not malformed responses — surface them unchanged so the outer
    // catch sanitizes them exactly as before. Only record latency + log.
    if (!(parseErr instanceof IpcError)) {
      recordIpcLatency(command, Math.round(performance.now() - callStart), budgetMs);
      console.error(`[IPC] invoke rejected for "${command}":`, parseErr);
    }
    throw parseErr;
  }
  if (response === null || typeof response !== 'object') {
    recordIpcLatency(command, Math.round(performance.now() - callStart), budgetMs);
    throw invalidResponseError(command, response);
  }
  return response;
}

export async function callInternal<K extends keyof CommandMap>(
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
    const invokePromise = tauriInvoke<ApiResponse<CommandMap[K]['return']>>(command, args);
    const response = await awaitIpcResponse(command, invokePromise, callStart, budgetMs);

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
        throw new IpcError({
          code: BackendErrorCode.InvalidResponse,
          message: `Invalid response shape from backend for "${command}"`,
          requestId: undefined,
          context: undefined,
          isRetryable: false,
        });
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
    throw new IpcError({
      code: BackendErrorCode.InternalError,
      message: `IPC call "${command}" returned no success/error payload`,
      requestId: undefined,
      context: undefined,
      isRetryable: false,
    });
  } catch (err) {
    const latencyMs = Math.round(performance.now() - callStart);
    recordIpcLatency(command, latencyMs, budgetMs);
    // Re-throw IpcError instances unchanged (they already carry the
    // structured fields from sanitizeError); sanitize anything else so
    // callers always catch a typed, context-carrying IpcError.
    if (err instanceof IpcError) {
      throw err;
    }
    throw new IpcError(sanitizeError(err));
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
  if (ipcStats.calls.length > IPC_CALLS_HISTORY_MAX) {
    ipcStats.calls.shift();
  }

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
 * Wrapper around Tauri's drag-drop event listener.
 *
 * Encapsulates the `@tauri-apps/api/webview` import so that no other module
 * needs to reach outside the IPC layer for drag-drop events (STANDARDS §5).
 *
 * @param handler - Callback receiving the typed drag-drop event
 * @returns A function that unsubscribes from the event when called
 */
export async function listenDragDrop(
  handler: (
    event:
      | {
          type: 'enter';
          paths: string[];
          position: { x: number; y: number };
        }
      | {
          type: 'over';
          position: { x: number; y: number };
        }
      | {
          type: 'drop';
          paths: string[];
          position: { x: number; y: number };
        }
      | {
          type: 'leave';
        }
  ) => void
): Promise<() => void> {
  if (!checkIsTauri()) return () => {};

  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  return await getCurrentWebview().onDragDropEvent((event) => {
    const { type } = event.payload;
    switch (type) {
      case 'enter':
        handler({
          type,
          paths: event.payload.paths,
          position: event.payload.position,
        });
        break;
      case 'over':
        handler({
          type,
          position: event.payload.position,
        });
        break;
      case 'drop':
        handler({
          type,
          paths: event.payload.paths,
          position: event.payload.position,
        });
        break;
      case 'leave':
        handler({ type });
        break;
    }
  });
}
