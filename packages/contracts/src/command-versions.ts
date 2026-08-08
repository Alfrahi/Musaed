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
