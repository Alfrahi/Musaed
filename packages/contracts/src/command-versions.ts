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
  cmd_ollama_generate_title: true,
  cmd_ollama_validate_model: true,

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
  cmd_rag_get_project: true,
  cmd_rag_index_project: true,
  cmd_rag_abort_index: true,
  cmd_rag_reindex_project: true,
  cmd_rag_retry_index_project: true,
  cmd_rag_get_index_status: true,
  cmd_rag_search: true,
  cmd_rag_get_file_chunks: true,
  cmd_rag_get_project_stats: true,
  cmd_rag_set_embedding_model: true,
  cmd_rag_validate_embedding_model: true,
  cmd_rag_assemble_context: true,

  // Dialog
  cmd_dialog_ask: true,

  // Export
  cmd_export_markdown: true,

  // Opener
  cmd_opener_open_url: true,

  // Conversations
  cmd_conversations_list: true,
  cmd_conversation_get: true,
  cmd_conversation_create: true,
  cmd_message_append: true,
  cmd_conversation_delete: true,
  cmd_conversations_clear: true,
  cmd_conversation_update: true,
} as const;

export type CommandName = keyof typeof COMMAND_VERSIONS;
