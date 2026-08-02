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
    hooks: [
      'useModelPulling',
      'useModelActions',
      'useModelCapabilities',
      'useEmbeddingModels',
      'useLibraryInitialization',
      'useLibraryTauriEvents',
    ],
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
  /**
   * Failure modes for this feature's IPC endpoints.
   *
   * @see STANDARDS.md §13 — Failure Mode Rule
   */
  failureModes: {
    cmd_ollama_get_models: {
      fallback:
        'Show cached model list if available, otherwise show empty library with error banner',
      retry: 'once',
      messageKey: 'error.failedToFetchModels',
    },
    cmd_ollama_delete_model: {
      fallback: 'Show error toast; model remains in list',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_ollama_pull_model: {
      fallback: 'Show error toast with pull progress reset; model not added to library',
      retry: 'once',
      messageKey: 'error.modelPullFailed',
    },
    cmd_ollama_abort_pull: {
      fallback: 'Silently ignore — abort is fire-and-forget',
      retry: 'none',
      messageKey: 'error.genericError',
    },
  },
  dependencies: [],
} as const;

export default manifest;
