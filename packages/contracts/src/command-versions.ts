/**
 * IPC command registry — single source of truth for every Tauri command
 * name and its current contract version.
 *
 * The frontend IPC bridge (`apps/web/src/lib/ipc.ts`) and the Rust backend
 * commands stay aligned via this map. Tests in `latency.test.ts` confirm
 * that every entry here has a matching latency budget.
 *
 * @see STANDARDS.md §10 IPC + Rust contract alignment
 */

export const COMMAND_VERSIONS = {
  // Ollama
  cmd_ollama_get_models: 1,
  cmd_ollama_chat: 1,
  cmd_ollama_abort_chat: 1,
  cmd_ollama_delete_model: 1,
  cmd_ollama_pull_model: 1,
  cmd_ollama_abort_pull: 1,
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
  cmd_rag_retry_index_project: 1,
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
