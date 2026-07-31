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
  ipcEndpoints: [
    // Layout orchestrates Tauri events and chat initialization
    'cmd_ollama_chat',
    'cmd_ollama_abort_chat',
    'cmd_message_append',
    'cmd_conversation_create',
  ],
  stateSchemas: {}, // No feature-specific state (uses global stores)
  persistenceSchemas: {}, // No persistent storage
  dependencies: [
    'conversation', // Composition dependency (exempt from import rules)
    'sidebar', // Composition dependency (exempt from import rules)
    'settings', // HomeClient.tsx imports SettingsModal from @/features/settings
  ],
} as const;

export default manifest;
