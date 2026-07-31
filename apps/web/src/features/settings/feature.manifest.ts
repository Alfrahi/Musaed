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
    conversationStore: 3,
  },
  persistenceSchemas: {
    settings: 'musaed-settings-storage',
    // logs are handled by Rust backend
  },
  dependencies: ['library'], // Settings accesses library functionality via lib/useModelActions abstraction
} as const;

export default manifest;
