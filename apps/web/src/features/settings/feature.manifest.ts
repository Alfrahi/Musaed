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
  ipcEndpoints: [
    'cmd_ollama_get_models',
    'cmd_ollama_delete_model',
    'cmd_ollama_pull_model',
    'cmd_ollama_check_health',
    'cmd_ollama_verify_service',
    'cmd_ollama_validate_model',
    'cmd_logs_append',
    'cmd_logs_clear',
    'cmd_trace_append',
  ],
  /**
   * Performance-sensitive IPC endpoints owned by this feature. The actual
   * thresholds (ms) live in `@musaed/contracts` (`IPC_LATENCY_BUDGETS`).
   *
   * @see STANDARDS.md §15 Performance Rules — IPC latency budgets per feature
   */
  latencyProfiles: {
    interactive: [
      'cmd_ollama_check_health',
      'cmd_ollama_verify_service',
      'cmd_ollama_get_models',
      'cmd_ollama_validate_model',
      'cmd_logs_clear',
    ],
    background: ['cmd_ollama_pull_model', 'cmd_ollama_delete_model'],
  },
  stateSchemas: {
    settingsStore: 1,
    conversationStore: 3,
  },
  persistenceSchemas: {
    settings: 'musaed-settings-storage',
    logs: 'logs.json',
  },
  dependencies: ['library'], // Settings accesses library functionality via lib/useModelActions abstraction
} as const;

export default manifest;
