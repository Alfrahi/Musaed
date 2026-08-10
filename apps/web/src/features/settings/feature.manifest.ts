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
      'useSettingsInitialization',
    ],
    components: ['SettingsModal'],
    utils: [],
  },
  ipcEndpoints: [
    'cmd_ollama_verify_service',
    'cmd_logs_request_clear_token',
    'cmd_logs_clear',
    // Storage-backed log/state export & import — `hooks/useStorageActions.ts`
    // and `hooks/useLogActions.ts` drive the tauri store + filesystem + native
    // file dialogs through the IPC-layer `storeApi`/`dialogApi`/`fsApi`.
    'cmd_store_load',
    'cmd_store_get',
    'cmd_store_set',
    'cmd_store_save',
    'cmd_dialog_save_file',
    'cmd_fs_write_text_file',
    'cmd_dialog_open_file',
    'cmd_fs_read_text_file',
  ],
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
    settingsStore: 4,
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
    cmd_store_load: {
      fallback: 'Show error toast; keep current in-memory state',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_store_get: {
      fallback: 'Treat as missing key — return undefined and continue',
      retry: 'none',
      messageKey: 'error.genericError',
    },
    cmd_store_set: {
      fallback: 'Show error toast; in-memory state already updated optimistically',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_store_save: {
      fallback: 'Show error toast; retry save on next user action',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_dialog_save_file: {
      fallback: 'Silently ignore — export cancelled by user',
      retry: 'none',
      messageKey: 'error.genericError',
    },
    cmd_fs_write_text_file: {
      fallback: 'Show error toast; exported file not written',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_dialog_open_file: {
      fallback: 'Silently ignore — import cancelled by user',
      retry: 'none',
      messageKey: 'error.genericError',
    },
    cmd_fs_read_text_file: {
      fallback: 'Show error toast; selected file not imported',
      retry: 'once',
      messageKey: 'error.genericError',
    },
  },
  dependencies: ['library'], // Settings accesses library functionality via lib/useModelActions abstraction
} as const;

export default manifest;
