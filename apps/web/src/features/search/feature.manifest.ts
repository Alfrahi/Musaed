/**
 * Search Feature Manifest
 * Message-level full-text search across conversations.
 *
 * This feature provides a search modal that queries the Rust backend
 * for messages matching a user-provided query string. Results are
 * grouped by conversation and clicking a result navigates to that
 * conversation.
 */

import type { FeatureManifest } from '@musaed/contracts';

const manifest: FeatureManifest = {
  name: 'search',
  version: '1.0.0',
  publicApi: {
    components: ['SearchModal'],
    hooks: ['useMessageSearch'],
    utils: [],
  },
  ipcEndpoints: ['cmd_conversation_search'],
  /**
   * Performance-sensitive IPC endpoint owned by this feature. The actual
   * threshold (ms) lives in `@musaed/contracts` (`IPC_LATENCY_BUDGETS`).
   *
   * @see STANDARDS.md §15 Performance Rules — IPC latency budgets per feature
   */
  latencyProfiles: {
    interactive: ['cmd_conversation_search'],
  },
  stateSchemas: {},
  /**
   * Failure modes for this feature's IPC endpoints.
   *
   * @see STANDARDS.md §13 — Failure Mode Rule
   */
  failureModes: {
    cmd_conversation_search: {
      fallback: 'Show empty results with error toast',
      retry: 'once',
      messageKey: 'error.genericError',
    },
  },
  // Search reads conversation metadata from the conversation store
  // and navigates to conversations via the conversation feature.
  dependencies: ['conversation'],
} as const;

export default manifest;
