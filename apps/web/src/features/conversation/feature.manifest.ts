/**
 * Chat Feature Manifest
 * Defines public API, IPC endpoints, and dependencies.
 */

export default {
  name: 'conversation',
  version: '1.0.0',
  publicApi: {
    hooks: [
      'useChatActions',
      'useConversationActions',
      'useAttachmentManager',
      'useTauriEvents',
      'useChatInitialization',
      'useAutoTitle',
      'triggerAutoTitle',
    ],
    utils: ['isDefaultTitle', 'generateConversationTitle'],
  },
  ipcEndpoints: [
    'cmd_ollama_chat',
    'cmd_ollama_abort_chat',
    'cmd_ollama_generate_title',
    'cmd_rag_search',
    'cmd_logs_append',
  ],
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
