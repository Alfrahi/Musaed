/**
 * Layout Feature Manifest
 * Application shell and root composition layer.
 * This feature is exempt from cross-feature import rules as it serves as the
 * composition root that mounts all other features.
 */

import type { FeatureManifest } from '@musaed/contracts';

const manifest: FeatureManifest = {
  name: 'layout',
  version: '1.0.0',
  publicApi: {
    components: ['HomeClient', 'CommandPalette'],
    hooks: [], // No hooks - pure composition layer
    utils: [],
  },
  ipcEndpoints: [], // Composition root — IPC is delegated to mounted features
  stateSchemas: {}, // No feature-specific state (uses global stores)
  /**
   * Failure modes: layout has no IPC endpoints of its own — all IPC is
   * delegated to mounted features. No failureModes needed.
   *
   * @see STANDARDS.md §13 — Failure Mode Rule
   */
  dependencies: [
    'conversation', // Composition dependency (exempt from import rules)
    'sidebar', // Composition dependency (exempt from import rules)
    'settings', // HomeClient.tsx imports SettingsModal from @/features/settings
  ],
} as const;

export default manifest;
