/**
 * Conversation Feature Manifest
 * Defines public API, IPC endpoints, and dependencies.
 */

import type { FeatureManifest } from '@musaed/contracts';

const manifest: FeatureManifest = {
  name: 'conversation',
  version: '1.0.0',
  publicApi: {
    hooks: [
      'useChatActions',
      'useConversationActions',
      'useConversationMessages',
      'useAttachmentManager',
      'useTauriEvents',
      'useChatInitialization',
      'useAutoTitle',
      'triggerAutoTitle',
    ],
    components: [],
    utils: ['isDefaultTitle', 'generateConversationTitle'],
  },
  ipcEndpoints: [
    'cmd_ollama_chat',
    'cmd_ollama_abort_chat',
    'cmd_ollama_generate_title',
    'cmd_rag_search',
    'cmd_logs_append',
  ],
  /**
   * Performance-sensitive IPC endpoints owned by this feature. The actual
   * thresholds (ms) live in `@musaed/contracts` (`IPC_LATENCY_BUDGETS`).
   * This section only declares *which* commands this feature cares about.
   *
   * @see STANDARDS.md §15 Performance Rules — IPC latency budgets per feature
   */
  latencyProfiles: {
    interactive: ['cmd_ollama_chat', 'cmd_ollama_abort_chat'],
    background: ['cmd_ollama_generate_title', 'cmd_rag_search'],
  },
  stateSchemas: {
    conversationStore: 3,
    messageStore: 1,
    streamingStore: 1,
  },
  persistenceSchemas: {
    conversation: 'musaed-conversation-storage-v2',
    message: 'musaed-message-storage-v1',
  },
  dependencies: [], // Access to library/rag/settings is via IPC/store hooks, not direct imports
} as const;

export default manifest;
