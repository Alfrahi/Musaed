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
  ipcEndpoints: ['cmd_opener_open_url'], // Uses opener API for external links - now implemented
  stateSchemas: {}, // No feature-specific state
  persistenceSchemas: {}, // No persistent storage
  dependencies: [], // Standalone feature with no dependencies
} as const;

export default manifest;
