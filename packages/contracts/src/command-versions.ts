/**
 * IPC command registry — the single source of truth for every Tauri command
 * name exposed through the typed IPC bridge.
 *
 * The frontend IPC bridge (`apps/web/src/lib/ipc.ts`) consults this registry
 * in development to warn about unregistered commands, and `latency.test.ts`
 * enumerates the keys to confirm every command has a latency budget.
 *
 * Breaking-change detection between the Rust `#[tauri::command]` signatures
 * and the TypeScript `CommandMap` is enforced at CI time by
 * `pnpm validate:contracts --strict` (scripts/validate-contracts.mjs), which
 * cross-checks argument count, names, types, and return types. There is no
 * runtime `_v1`/`_v2` command-name versioning scheme; the versioning
 * scaffolding that prior revisions of STANDARDS.md §5 described was removed
 * because it was never enforced and gave a false impression of a versioned
 * contract.
 *
 * @see STANDARDS.md §5 IPC System
 * @see STANDARDS.md §10 IPC + Rust contract alignment
 */

import type { OllamaModel, OllamaHealth, ModelValidation } from './types/ollama';
import type { ChatMessage } from './types/chat';
import type { ChatOptions, TraceEntryInput, TraceContext, TraceStatus } from './schemas/validation';
import type { FileFilter } from './types/ui';
import type {
  RagProject,
  SearchResult,
  ChunkRecord,
  FileRecord,
  AssembledContext,
} from './types/rag';
import type { Conversation, Message } from './types/conversation';
import type { MessageSearchResult } from './schemas/conversation';
import type { RunMigrationsResponse, MigrationStatus, MigrationInfo } from './migrations';
import type {
  ContextMenuKind,
  ContextMenuLabels,
  ContextMenuResponse,
} from './schemas/context-menu';
import type { BackgroundTasksResponse } from './schemas/tray';
import type { MenuBarLabels } from './schemas/menu-bar';

/**
 * Latest RAG SQLite schema version. Mirrors the Rust `LATEST_SCHEMA_VERSION`
 * in `src-tauri/src/rag/store/connection.rs` so the frontend can reason about
 * migration targets without a round trip.
 */
export const LATEST_SCHEMA_VERSION = 2;

export const COMMAND_VERSIONS = {
  // Ollama
  cmd_ollama_get_models: true,
  cmd_ollama_chat: true,
  cmd_ollama_abort_chat: true,
  cmd_ollama_delete_model: true,
  cmd_ollama_pull_model: true,
  cmd_ollama_abort_pull: true,
  cmd_ollama_check_health: true,
  cmd_ollama_verify_service: true,
  cmd_ollama_validate_model: true,
  cmd_ollama_generate_title: true,

  // Logging
  cmd_logs_append: true,
  cmd_logs_request_clear_token: true,
  cmd_logs_clear: true,

  // Tracing
  cmd_trace_append: true,
  cmd_trace_start: true,
  cmd_trace_complete: true,
  cmd_trace_get_context: true,

  // RAG
  cmd_rag_add_project: true,
  cmd_rag_remove_project: true,
  cmd_rag_update_project: true,
  cmd_rag_list_projects: true,
  cmd_rag_index_project: true,
  cmd_rag_abort_index: true,
  cmd_rag_reindex_project: true,
  cmd_rag_retry_index_project: true,
  cmd_rag_search: true,
  cmd_rag_get_file_chunks: true,
  cmd_rag_list_files: true,
  cmd_rag_set_embedding_model: true,
  cmd_rag_assemble_context: true,

  // Dialog
  cmd_dialog_ask: true,
  cmd_dialog_open_file: true,
  cmd_dialog_save_file: true,

  // Opener
  cmd_opener_open_url: true,

  // Store
  cmd_store_load: true,
  cmd_store_get: true,
  cmd_store_set: true,
  cmd_store_save: true,
  cmd_store_delete: true,

  // Filesystem
  cmd_fs_read_text_file: true,
  cmd_fs_read_file: true,
  cmd_fs_write_text_file: true,

  // Conversations
  cmd_conversations_list: true,
  cmd_conversation_get: true,
  cmd_conversation_create: true,
  cmd_message_append: true,
  cmd_message_delete: true,
  cmd_conversation_delete: true,
  cmd_conversations_clear: true,
  cmd_conversation_update: true,
  cmd_conversation_search: true,

  // Migrations — backend SQLite schema migrations, exposed to the frontend
  // via the typed IPC bridge so the Settings/Diagnostics UI can drive them.
  cmd_run_migrations: true,
  cmd_rollback_migrations: true,
  cmd_get_migration_status: true,
  cmd_list_migrations: true,

  // Context menu — native Tauri popup menu for right-click surfaces
  // Native menu building lives in the Rust
  // `context_menu` domain; this registry entry pairs with the typed
  // `cmd_context_menu_show` adapter declared in `apps/web/src/lib/ipc.ts`.
  cmd_context_menu_show: true,

  // App metadata — read-only version string sourced from tauri.conf.json.
  // Declared shared (see SHARED_COMMANDS) so any feature can call it without
  // declaring a cross-feature dependency; it carries no domain state.
  cmd_get_app_version: true,

  // System tray — query active background tasks (chat streams, model pulls,
  // RAG indexing) so the frontend and tray close handler can decide between
  // minimize-to-tray and normal exit. Cross-cutting infrastructure, declared
  // shared so any feature can consume it.
  cmd_tray_get_background_status: true,

  // Menu bar — rebuild the native macOS menu bar with translated labels.
  // Called by the frontend after locale hydration/change so the menu bar
  // honours the user's language preference. Cross-cutting infrastructure,
  // declared shared so any feature can trigger a rebuild.
  cmd_menu_rebuild: true,
} as const;

/**
 * Commands that are infrastructure / cross-cutting and may be called from
 * any feature without being declared in a feature manifest. The manifest
 * validator skips these when checking IPC drift.
 */
export const SHARED_COMMANDS = {
  cmd_dialog_ask: true,
  cmd_opener_open_url: true,
  cmd_get_app_version: true,
  cmd_tray_get_background_status: true,
  cmd_menu_rebuild: true,
} as const;

export type CommandName = keyof typeof COMMAND_VERSIONS;

/**
 * Reverse type map: each command name to its `{ args, return }` signature.
 *
 * The IPC bridge (`apps/web/src/lib/ipc.ts`) dispatches through this map so
 * TypeScript call sites are type-checked against the same contract
 * `scripts/validate-contracts.mjs` verifies against the Rust
 * `#[tauri::command]` signatures at CI time. Args are declared inline (not
 * via shared interfaces) so the validator can cross-check field names
 * against the Rust signatures (STANDARDS §10).
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

  // Conversation commands
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

  // Context menu — native Tauri popup menu for right-click surfaces.
  // The frontend sends the surface kind, screen coordinates, and translated
  // labels; the backend builds a native menu and returns the selected action
  // id (or null if dismissed).
  cmd_context_menu_show: {
    args: {
      kind: ContextMenuKind;
      labels: Partial<ContextMenuLabels>;
      x: number;
      y: number;
    };
    return: ContextMenuResponse;
  };

  // App metadata — canonical version string sourced from tauri.conf.json.
  // The Rust command takes only the Tauri-injected `AppHandle`, so its
  // user-facing argument shape is empty.
  cmd_get_app_version: { args: Record<string, never>; return: string };

  // System tray — query active background tasks (chat streams, model pulls,
  // RAG indexing) so the frontend and tray close handler can decide between
  // minimize-to-tray and normal exit.
  cmd_tray_get_background_status: {
    args: Record<string, never>;
    return: BackgroundTasksResponse;
  };

  // Menu bar — rebuild the native macOS menu bar with translated labels.
  cmd_menu_rebuild: {
    args: { labels: MenuBarLabels };
    return: boolean;
  };
}

// Compile-time exhaustiveness: every COMMAND_VERSIONS key must appear in
// CommandMap, and vice versa. Drift fails type-check.
type AssertNoKeyDrift<Missing, Extra> = [Missing] extends [never]
  ? [Extra] extends [never]
    ? true
    : never
  : never;
export type _CommandMapCoverage = AssertNoKeyDrift<
  Exclude<CommandName, keyof CommandMap>,
  Exclude<keyof CommandMap, CommandName>
>;
