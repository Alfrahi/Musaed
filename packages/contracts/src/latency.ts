/**
 * Source of truth for IPC latency budgets — shared between the IPC bridge
 * and unit tests.
 *
 * STANDARDS.md §15 (Performance Rules) calls for "IPC latency budgets per feature".
 * The frontend IPC bridge owns the runtime measurement and violation reporting;
 * this module centralises the threshold map so the values can be referenced
 * consistently from tests, feature manifests, and observability tooling.
 *
 * Conventions:
 *  - Hover/budget categories in the bridge file are documented inline.
 *  - Every command in `COMMAND_VERSIONS` should have a non-zero budget here.
 *  - Adding a new IPC command requires adding the budget here as well; CI
 *    detects drift via the equality test in `contracts/latency.test.ts`.
 */

import { COMMAND_VERSIONS } from './command-versions';

export type LatencyBudgetMs = number;

export interface IpcCallStat {
  command: string;
  latencyMs: number;
  budgetMs: LatencyBudgetMs;
  status: 'ok' | 'violation';
}

/**
 * Canonical IPC Latency Budgets — thresholds (ms) per command.
 *
 * Categories:
 *   - Lightweight status / metadata checks: 500–2000 ms
 *   - Model management: 3000–8000 ms
 *   - Chat initiation (hand-off only — streaming tracked separately): 3000 ms
 *   - RAG lightweight metadata ops: 1000–2000 ms
 *   - RAG heavy ops (search / context assembly): 5000–20000 ms
 *   - Conversation persistence: 1000–3000 ms
 *   - Logging & tracing fire-and-forget: 500–1000 ms
 */
export const IPC_LATENCY_BUDGETS: Readonly<Record<string, LatencyBudgetMs>> = {
  /** Lightweight status checks — must return near-instantly */
  cmd_ollama_check_health: 2000,
  cmd_ollama_verify_service: 2000,
  cmd_ollama_get_models: 5000,
  /** Model management — moderate weight */
  cmd_ollama_delete_model: 5000,
  cmd_ollama_pull_model: 3000,
  cmd_ollama_abort_pull: 1000,
  cmd_ollama_abort_chat: 1000,
  /** Chat initiation — fast handoff; streaming is tracked separately */
  cmd_ollama_chat: 3000,
  cmd_ollama_generate_title: 10000,
  /** Logging & tracing — fire-and-forget, low limit */
  cmd_logs_append: 500,
  cmd_logs_request_clear_token: 500,
  cmd_logs_clear: 1000,
  cmd_trace_append: 500,
  cmd_trace_start: 500,
  cmd_trace_complete: 500,
  cmd_trace_get_context: 500,
  /** UI dialogs — user-blocking, fast required */
  cmd_dialog_ask: 1000,
  cmd_opener_open_url: 1000,
  /** RAG management — lightweight metadata ops */
  cmd_rag_list_projects: 2000,
  cmd_rag_index_project: 5000,
  cmd_rag_abort_index: 1000,
  cmd_rag_reindex_project: 5000,
  cmd_rag_retry_index_project: 5000,
  cmd_rag_search: 15000,
  cmd_rag_get_file_chunks: 5000,
  cmd_rag_set_embedding_model: 3000,
  cmd_rag_assemble_context: 20000,
  /** Conversation management — lightweight persistence */
  cmd_conversations_list: 3000,
  cmd_conversation_get: 2000,
  cmd_conversation_create: 2000,
  cmd_conversation_delete: 1000,
  cmd_conversations_clear: 2000,
  cmd_conversation_update: 2000,
  cmd_message_append: 1000,
  /** Backend SQLite migrations — heavyweight, run on user request */
  cmd_run_migrations: 10000,
  cmd_rollback_migrations: 10000,
  cmd_get_migration_status: 2000,
  cmd_list_migrations: 1000,
  /** Native context-menu popup — user-blocking, must appear near-instantly.
   * Selection wait is bounded by user reaction time, but the show path itself
   * (menu build + popup_at) must stay well under a second. */
  cmd_context_menu_show: 1000,
} as const;

/**
 * Returns the latency budget (ms) for a given IPC command.
 *
 * Returns 0 when the command has no explicit budget — the IPC bridge treats
 * that as "unlimited" and never reports a violation for it.
 */
export function getIpcLatencyBudget(command: string): LatencyBudgetMs {
  return IPC_LATENCY_BUDGETS[command] ?? 0;
}

/**
 * Returns the budget category label for a command. Helpful for telemetry
 * aggregation and for the diagnostics UI.
 */
export type LatencyBudgetCategory =
  | 'status'
  | 'model-mgmt'
  | 'chat'
  | 'title'
  | 'logging'
  | 'tracing'
  | 'dialog'
  | 'opener'
  | 'rag-light'
  | 'rag-mutation'
  | 'rag-heavy'
  | 'conversation'
  | 'migration'
  | 'context-menu';

export function getIpcLatencyBudgetCategory(command: string): LatencyBudgetCategory | undefined {
  if (command.startsWith('cmd_ollama_check_') || command === 'cmd_ollama_verify_service') {
    return 'status';
  }
  if (command.startsWith('cmd_ollama_')) {
    if (command === 'cmd_ollama_chat') return 'chat';
    if (command === 'cmd_ollama_generate_title') return 'title';
    return 'model-mgmt';
  }
  if (command.startsWith('cmd_logs_')) return 'logging';
  if (command.startsWith('cmd_trace_')) return 'tracing';
  if (command === 'cmd_dialog_ask') return 'dialog';
  if (command === 'cmd_opener_open_url') return 'opener';
  if (command === 'cmd_context_menu_show') return 'context-menu';
  if (command.startsWith('cmd_rag_list_') || command.startsWith('cmd_rag_get_')) {
    return 'rag-light';
  }
  if (
    command === 'cmd_rag_add_project' ||
    command === 'cmd_rag_remove_project' ||
    command === 'cmd_rag_update_project' ||
    command === 'cmd_rag_set_embedding_model'
  ) {
    return 'rag-mutation';
  }
  if (command.startsWith('cmd_rag_')) return 'rag-heavy';
  if (
    command === 'cmd_run_migrations' ||
    command === 'cmd_rollback_migrations' ||
    command === 'cmd_get_migration_status' ||
    command === 'cmd_list_migrations'
  ) {
    return 'migration';
  }
  if (command.startsWith('cmd_conversation') || command.startsWith('cmd_message_')) {
    return 'conversation';
  }
  return undefined;
}

/**
 * Aggregated IPC performance statistics.
 *
 * Exposed via the IPC bridge so tests and observability tooling can assert
 * on budget compliance after a sequence of calls.
 */
export interface IpcStats {
  callCount: number;
  violationCount: number;
  calls: IpcCallStat[];
}

/**
 * Returns true when every command registered in COMMAND_VERSIONS has a
 * positive budget. Used by unit tests and CI to detect drift.
 */
export function areAllCommandsBudgeted(): boolean {
  const names = Object.keys(COMMAND_VERSIONS);
  return names.every((name) => (IPC_LATENCY_BUDGETS[name] ?? 0) > 0);
}
