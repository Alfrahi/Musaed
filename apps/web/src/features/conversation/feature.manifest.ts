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
      'useAutoTitle',
      'triggerAutoTitle',
    ],
    components: [],
    utils: ['isDefaultTitle', 'generateConversationTitle', 'initializeConversations'],
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
    conversationStore: 2,
    messageStore: 2,
    streamingStore: 2,
  },
  persistenceSchemas: {
    conversation: 'musaed-conversation-storage',
    // message store is handled by Rust backend - in-memory cache only
  },
  // `library` is a declared dependency because InputArea.tsx composes the
  // library feature's ModelSelector component into the chat input chrome.
  // dep-cruiser honors this list (see scripts/codegen-feature-deps.mjs).
  dependencies: ['library'],
} as const;

export default manifest;
