/**
 * Library (Models) Feature Manifest
 * Defines public API, IPC endpoints, and dependencies.
 */

import type { FeatureManifest } from '@musaed/contracts';

const manifest: FeatureManifest = {
  name: 'library',
  version: '1.0.0',
  publicApi: {
    components: ['ModelLibrary', 'ModelCard', 'ModelSelector'],
    hooks: ['useModelPulling', 'useModelActions', 'useModelCapabilities'],
    utils: [],
  },
  ipcEndpoints: [
    'cmd_ollama_get_models',
    'cmd_ollama_delete_model',
    'cmd_ollama_pull_model',
    'cmd_ollama_abort_pull',
  ],
  /**
   * Performance-sensitive IPC endpoints owned by this feature. The actual
   * thresholds (ms) live in `@musaed/contracts` (`IPC_LATENCY_BUDGETS`).
   *
   * @see STANDARDS.md §15 Performance Rules — IPC latency budgets per feature
   */
  latencyProfiles: {
    interactive: ['cmd_ollama_get_models'],
    background: ['cmd_ollama_pull_model', 'cmd_ollama_delete_model'],
  },
  stateSchemas: {
    modelStore: 1,
  },
  persistenceSchemas: {
    models: 'musaed-model-storage',
  },
  dependencies: [],
} as const;

export default manifest;
