'use client';

import { type BackendError } from './errors';

// Core re-exports for the contracts package
export * from './errors';
export * from './constants';
export type * from './types/ollama';
export type * from './types/chat';
export type * from './types/ui';
export type * from './types/conversation';
export type * from './types/rag';
export * from './schemas/ollama';
export * from './schemas/chat';
export * from './schemas/rag';
export * from './schemas/conversation';
export * from './schemas/validation';
export * from './utils/sanitize';
export * from './utils/thinking-tags';
export * from './utils/workerUtils';
export * from './utils/async';

// API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: BackendError;
}

// IPC versioning
export const IPC_VERSION = 1;

// Generated types from Rust
// export * from './generated/specta-types';
export const COMMAND_VERSIONS = {
  // Ollama
  cmd_ollama_get_models: 1,
  cmd_ollama_chat: 1,
  cmd_ollama_abort_chat: 1,
  cmd_ollama_delete_model: 1,
  cmd_ollama_pull_model: 1,
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
