import { z } from 'zod';
import {
  type ApiResponse,
  type OllamaModel,
  type ChatMessage,
  type ChatOptions,
  type OllamaHealth,
  type ModelValidation,
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
  AssembledContextSchema,
  type Conversation,
  type Message,
  ConversationSchema,
  MessageSearchResultSchema,
  type MessageSearchResult,
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
  // Context menu contracts
  ContextMenuKindSchema,
  ContextMenuResponseSchema,
  ContextMenuLabelsSchema,
  type ContextMenuKind,
  type ContextMenuRequest,
  type ContextMenuResponse,
  type ContextMenuLabels,
  // System tray contracts
  BackgroundTasksResponseSchema,
  type BackgroundTasksResponse,
  MenuBarLabelsSchema,
  type MenuBarLabels,
} from '@musaed/contracts';
import type {
  RagProject,
  SearchResult,
  ChunkRecord,
  FileRecord,
  AssembledContext,
  FileFilter,
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
  cmd_ollama_validate_model: { args: { baseUrl: string; name: string }; return: ModelValidation };
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

  // Opener commands
  cmd_opener_open_url: { args: { url: string }; return: boolean };

  // File dialog commands
  cmd_dialog_open_file: {
    args: {
      filters?: FileFilter[];
      multiple?: boolean;
      directory?: boolean;
      defaultPath?: string;
    };
    return: string[] | null;
  };
  cmd_dialog_save_file: {
    args: {
      filters?: FileFilter[];
      defaultPath?: string;
    };
    return: string | null;
  };

  // Store commands
  cmd_store_load: { args: { file: string }; return: boolean };
  cmd_store_get: { args: { file: string; key: string }; return: unknown };
  cmd_store_set: { args: { file: string; key: string; value: unknown }; return: boolean };
  cmd_store_save: { args: { file: string }; return: boolean };
  cmd_store_delete: { args: { file: string; key: string }; return: boolean };

  // Filesystem commands
  cmd_fs_read_text_file: { args: { path: string }; return: string };
  cmd_fs_read_file: { args: { path: string }; return: string };
  cmd_fs_write_text_file: { args: { path: string; content: string }; return: boolean };

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
  cmd_rag_index_project: {
    args: { projectId: string; force?: boolean; baseUrl?: string };
    return: boolean;
  };
  cmd_rag_abort_index: { args: { projectId: string }; return: boolean };
  cmd_rag_reindex_project: { args: { projectId: string; baseUrl?: string }; return: boolean };
  cmd_rag_retry_index_project: { args: { projectId: string; baseUrl?: string }; return: boolean };
  cmd_rag_search: {
    args: { projectId: string; query: string; topK?: number; threshold?: number; baseUrl?: string };
    return: SearchResult[];
  };
  cmd_rag_get_file_chunks: { args: { projectId: string; filePath: string }; return: ChunkRecord[] };
  cmd_rag_list_files: { args: { projectId: string }; return: FileRecord[] };
  cmd_rag_set_embedding_model: { args: { projectId: string; modelName: string }; return: boolean };
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
  cmd_message_delete: { args: { conversationId: string; messageId: string }; return: void };
  cmd_conversation_delete: { args: { id: string }; return: void };
  cmd_conversations_clear: { args: Record<string, never>; return: void };
  cmd_conversation_update: { args: { id: string; title: string; updatedAt: number }; return: void };

  // Message search — full-text search across all conversation messages.
  // Returns results grouped by conversation with matching message snippets.
  cmd_conversation_search: {
    args: { query: string; limit: number };
    return: MessageSearchResult[];
  };

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

  // Context menu — native Tauri popup menu for right-click surfaces
  // The frontend sends the surface kind, screen
  // coordinates, and translated labels; the backend builds a native menu
  // and returns the selected action id (or null if dismissed).
  // Args are declared inline (not via ContextMenuRequest) so the CI
  // contract validator can cross-check field names against the Rust
  // `cmd_context_menu_show` signature (STANDARDS §10).
  cmd_context_menu_show: {
    args: {
      kind: ContextMenuKind;
      labels: Partial<ContextMenuLabels>;
      x: number;
      y: number;
    };
    return: ContextMenuResponse;
  };

  // App metadata — canonical version string sourced from tauri.conf.json
  // via the compile-time embedded PackageInfo. The Rust
  // command takes only the Tauri-injected `AppHandle`, so its user-facing
  // argument shape is empty. Declared as a SHARED_COMMAND so any feature
  // can fetch the version without declaring an IPC endpoint in its manifest.
  cmd_get_app_version: { args: Record<string, never>; return: string };

  // System tray — query active background tasks (chat streams, model pulls,
  // RAG indexing) so the frontend and tray close handler can decide between
  // minimize-to-tray and normal exit. Declared as a SHARED_COMMAND so any
  // feature can consume it without a manifest dependency.
  cmd_tray_get_background_status: {
    args: Record<string, never>;
    return: BackgroundTasksResponse;
  };

  // Menu bar — rebuild the native macOS menu bar with translated labels.
  // Called by the frontend after locale hydration/change. Declared as a
  // SHARED_COMMAND so any feature can trigger a rebuild without a manifest
  // dependency.
  cmd_menu_rebuild: {
    args: { labels: MenuBarLabels };
    return: boolean;
  };
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
    kind: z.string().optional(),
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
  cmd_store_load: z.object({ file: z.string().min(1) }),
  cmd_store_get: z.object({ file: z.string().min(1), key: z.string().min(1) }),
  cmd_store_set: z.object({
    file: z.string().min(1),
    key: z.string().min(1),
    value: z.unknown(),
  }),
  cmd_store_save: z.object({ file: z.string().min(1) }),
  cmd_store_delete: z.object({ file: z.string().min(1), key: z.string().min(1) }),

  // Filesystem command input schemas
  cmd_fs_read_text_file: z.object({
    path: z.string().min(1).max(MAX_FILE_PATH_LEN),
  }),
  cmd_fs_read_file: z.object({
    path: z.string().min(1).max(MAX_FILE_PATH_LEN),
  }),
  cmd_fs_write_text_file: z.object({
    path: z.string().min(1).max(MAX_FILE_PATH_LEN),
    content: z.string(),
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
    const invokePromise = tauriInvoke<ApiResponse<CommandMap[K]['return']>>(command, args);
    const response = await Promise.race([invokePromise, createIpcTimeout(command, budgetMs)]);

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
 * Ollama Engine API - manages Ollama server interactions.
 * - getModels: fetches list of installed models
 * - deleteModel: removes a model from the server
 * - pullModel: downloads a model (async, void return)
 * - checkHealth: checks if Ollama is running (quiet, no toast)
 * - verifyService: performs a simple ping to verify Ollama responds
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
   * Validates that a model exists on the Ollama server and returns its
   * metadata, including the `context_length` parsed from `/api/show`.
   * @param baseUrl - The Ollama server URL
   * @param name - The model name to validate
   * @returns Model validation result with contextLength, or null on failure
   */
  validateModel: (baseUrl: string, name: string) =>
    callInternal('cmd_ollama_validate_model', { baseUrl, name }, { quiet: true }),
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

  /**
   * Shows a native file/folder open dialog and returns the selected path(s).
   * @param opts - { filters?, multiple?, directory?, defaultPath? }
   * @returns Array of selected paths, or null if cancelled
   */
  openFile: (opts: CommandMap['cmd_dialog_open_file']['args']) =>
    callInternal('cmd_dialog_open_file', opts),

  /**
   * Shows a native file save dialog and returns the selected path.
   * @param opts - { filters?, defaultPath? }
   * @returns The selected save path, or null if cancelled
   */
  saveFile: (opts: CommandMap['cmd_dialog_save_file']['args']) =>
    callInternal('cmd_dialog_save_file', opts),
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
 * Store API - persistent key-value storage via Rust commands.
 *
 * Replaces the direct tauri-plugin-store wrapper. All store operations
 * now route through `callInternal`, which provides Zod validation,
 * latency tracking, and error sanitization.
 */
export const storeApi = {
  /**
   * Loads a store file.
   * @param file - Store filename (e.g. "logs.json")
   * @returns true if the store was loaded successfully
   */
  load: (file: string) => callInternal('cmd_store_load', { file }),

  /**
   * Gets a value from a store by key.
   * @param file - Store filename
   * @param key - The key to retrieve
   * @returns The value if found, null otherwise
   */
  get: (file: string, key: string) => callInternal('cmd_store_get', { file, key }),

  /**
   * Sets a value in a store by key.
   * @param file - Store filename
   * @param key - The key to set
   * @param value - JSON-serializable value to store
   * @returns true if the value was set
   */
  set: (file: string, key: string, value: unknown) =>
    callInternal('cmd_store_set', { file, key, value }),

  /**
   * Saves a store to disk.
   * @param file - Store filename
   * @returns true if saved successfully
   */
  save: (file: string) => callInternal('cmd_store_save', { file }),

  /**
   * Deletes a key from a store.
   * @param file - Store filename
   * @param key - The key to delete
   * @returns true if the key was deleted
   */
  delete: (file: string, key: string) => callInternal('cmd_store_delete', { file, key }),
};

/**
 * Filesystem API - file read/write operations via Rust commands.
 *
 * Replaces the direct `@tauri-apps/plugin-fs` plugin wrapper. All
 * filesystem access now goes through `callInternal` for validation,
 * latency tracking, and error sanitization (STANDARDS §16).
 */
export const fsApi = {
  /**
   * Reads a text file from the filesystem.
   * @param path - Absolute path to the file
   * @returns The file contents as a string, or null on failure
   */
  readTextFile: (path: string) => callInternal('cmd_fs_read_text_file', { path }),

  /**
   * Reads a binary file from the filesystem, returned as base64.
   * @param path - Absolute path to the file
   * @returns Base64-encoded file contents, or null on failure
   */
  readFile: (path: string) => callInternal('cmd_fs_read_file', { path }),

  /**
   * Writes text content to a file on the filesystem.
   * @param path - Absolute path to the file
   * @param content - Text content to write
   * @returns true if the write succeeded
   */
  writeTextFile: (path: string, content: string) =>
    callInternal('cmd_fs_write_text_file', { path, content }),
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
   * Lists all indexed files for a project.
   * @param projectId - The project identifier
   * @returns Array of FileRecord objects with file paths and metadata
   */
  listFiles: (projectId: string) => callInternal('cmd_rag_list_files', { projectId }),
  /**
   * Changes the embedding model used by a project.
   * @param projectId - The project identifier
   * @param modelName - Name of the embedding model to switch to
   * @returns true if model was updated successfully, false otherwise
   */
  setEmbeddingModel: (projectId: string, modelName: string) =>
    callInternal('cmd_rag_set_embedding_model', { projectId, modelName }),
  /**
   * Performs semantic search and assembles a RAG context in a single IPC call.
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
  deleteMessage: (conversationId: string, messageId: string) =>
    callInternal('cmd_message_delete', { conversationId, messageId }),
  deleteConversation: (id: string) => callInternal('cmd_conversation_delete', { id }),
  clearAllConversations: () => callInternal('cmd_conversations_clear', {}),
  updateConversation: (id: string, title: string, updatedAt: number) =>
    callInternal('cmd_conversation_update', { id, title, updatedAt }),
  /**
   * Search messages across all conversations.
   * @param query - Search query string (min 1 char)
   * @param limit - Maximum number of results (1-100)
   * @returns Array of MessageSearchResult grouped by conversation
   */
  searchMessages: (query: string, limit: number) =>
    callInternal('cmd_conversation_search', { query, limit }),
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

/**
 * Context Menu API — native Tauri popup menu for right-click surfaces.
 *
 * The frontend sends the surface kind (conversation/message/codeBlock),
 * target id, screen coordinates from the `contextmenu` MouseEvent, and
 * translated labels. The Rust backend builds a native menu and returns
 * the selected action id (or null if the user dismissed the menu).
 *
 * @see STANDARDS.md §5  IPC System
 * @see STANDARDS.md §16 Security Model
 */
export const contextMenuApi = {
  /**
   * Shows a native context menu at the given screen position.
   * @param kind - Surface kind: 'conversation' | 'message' | 'codeBlock'
   * @param x - Screen X coordinate from the contextmenu event
   * @param y - Screen Y coordinate from the contextmenu event
   * @param labels - Translated labels for each menu item
   * @returns The selected action id, or null if dismissed
   */
  show: (
    kind: ContextMenuRequest['kind'],
    x: number,
    y: number,
    labels: Partial<ContextMenuLabels>
  ) =>
    callInternal('cmd_context_menu_show', {
      kind,
      x,
      y,
      labels: {
        rename: '',
        export: '',
        delete: '',
        copy: '',
        regenerate: '',
        ...labels,
      },
    }),
};

/**
 * App Metadata API — read-only application info sourced from
 * `tauri.conf.json` via the compile-time embedded `PackageInfo`.
 *
 * The version returned here is the single source of truth — `Cargo.toml`
 * and `apps/web/package.json` are aligned to match it so the installer,
 * About modal, and sidebar all show the same string.
 *
 * Declared as a SHARED_COMMAND in `packages/contracts/src/command-versions.ts`
 * so any feature can consume it without declaring an IPC endpoint in its
 * feature manifest.
 *
 * @see STANDARDS.md §5  IPC System
 * @see STANDARDS.md §10 IPC + Rust contract alignment
 */
export const appApi = {
  /**
   * Returns the canonical application version string (e.g. `"0.1.1"`).
   *
   * The promise rejects to `null` when running outside Tauri (dev/SSR
   * guard) — callers should treat `null` as "unknown" and render a
   * fallback rather than a hardcoded literal.
   */
  getVersion: () => callInternal('cmd_get_app_version', {}),
};

/**
 * System Tray API — query background-task status.
 *
 * Returns the active background operations (chat streams, model pulls, RAG
 * indexing) so the frontend can show status indicators or decide whether
 * it's safe to close the window. Declared as a SHARED_COMMAND so any feature
 * can consume it without a manifest dependency.
 *
 * @see STANDARDS.md §5  IPC System
 * @see STANDARDS.md §13 Failure Mode Rule
 */
export const trayApi = {
  /**
   * Returns the current background-task status.
   *
   * @returns An object with `tasks` (array of active task kinds + counts)
   * and `hasActiveTasks` (convenience boolean). Returns `null` when running
   * outside Tauri or if the call fails.
   */
  getBackgroundStatus: () => callInternal('cmd_tray_get_background_status', {}),
};

/**
 * Menu bar IPC API.
 *
 * @see STANDARDS.md §5  IPC System
 * @see STANDARDS.md §13 Failure Mode Rule
 */
export const menuBarApi = {
  /**
   * Rebuilds the native macOS menu bar with translated labels.
   *
   * Called after locale hydration or when the user switches language. On
   * Windows/Linux this is a no-op that returns `true`.
   *
   * @param labels - Translated labels for the custom (non-predefined) menu items.
   * @returns `true` on success, `null` if running outside Tauri.
   */
  rebuild: (labels: MenuBarLabels) => callInternal('cmd_menu_rebuild', { labels }),
};
