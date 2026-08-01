/**
 * Settings Feature Manifest
 * Defines public API, IPC endpoints, and dependencies.
 */

import type { FeatureManifest } from '@musaed/contracts';

const manifest: FeatureManifest = {
  name: 'settings',
  version: '1.0.0',
  publicApi: {
    hooks: [
      'useSettingsActions',
      'useLogActions',
      'useStorageActions',
      'useStorageCleanup',
      'useIpcLatencyStats',
      'useIpcViolations',
    ],
    components: ['SettingsModal'],
    utils: [],
  },
  ipcEndpoints: ['cmd_ollama_verify_service', 'cmd_logs_request_clear_token', 'cmd_logs_clear'],
  /**
   * Performance-sensitive IPC endpoints owned by this feature. The actual
   * thresholds (ms) live in `@musaed/contracts` (`IPC_LATENCY_BUDGETS`).
   *
   * @see STANDARDS.md §15 Performance Rules — IPC latency budgets per feature
   */
  latencyProfiles: {
    interactive: ['cmd_ollama_verify_service', 'cmd_logs_clear'],
    background: [],
  },
  stateSchemas: {
    settingsStore: 2,
    // `conversationStore` is owned by the `conversation` feature — settings
    // reads it via `useStorageActions` but does not own its schema.
  },
  /**
   * Failure modes for this feature's IPC endpoints.
   *
   * @see STANDARDS.md §13 — Failure Mode Rule
   */
  failureModes: {
    cmd_ollama_verify_service: {
      fallback: 'Show connection error banner; keep current settings intact',
      retry: 'once',
      messageKey: 'error.ollamaError',
    },
    cmd_logs_request_clear_token: {
      fallback: 'Show error toast; logs remain viewable',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_logs_clear: {
      fallback: 'Show error toast; logs remain in viewer',
      retry: 'once',
      messageKey: 'error.genericError',
    },
  },
  dependencies: ['library'], // Settings accesses library functionality via lib/useModelActions abstraction
} as const;

export default manifest;
