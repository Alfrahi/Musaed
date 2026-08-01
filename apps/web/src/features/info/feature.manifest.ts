/**
 * Info Feature Manifest
 * Provides application information and about modal functionality.
 * This is a UI-only feature with no state management or business logic.
 */

import type { FeatureManifest } from '@musaed/contracts';

const manifest: FeatureManifest = {
  name: 'info',
  version: '1.0.0',
  publicApi: {
    components: ['InfoModal'],
    hooks: [],
    utils: [],
  },
  ipcEndpoints: [],
  stateSchemas: {}, // No feature-specific state
  /**
   * Failure modes for this feature's IPC endpoints.
   *
   * @see STANDARDS.md §13 — Failure Mode Rule
   */
  failureModes: {},
  dependencies: [], // Standalone feature with no dependencies
} as const;

export default manifest;
