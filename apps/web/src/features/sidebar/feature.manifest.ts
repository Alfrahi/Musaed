/**
 * Sidebar Feature Manifest
 * Defines public API, IPC endpoints, and dependencies.
 */

export default {
  name: 'sidebar',
  version: '1.0.0',
  publicApi: {
    components: [
      'Sidebar',
      'SidebarSkeleton',
      'SidebarHeader',
      'SidebarInfo',
      'SearchInput',
      'ConversationItem',
    ],
    hooks: ['useSidebarActions', 'useSidebarGrouping'],
    utils: ['exportToMarkdown'],
  },
  ipcEndpoints: ['cmd_dialog_ask', 'cmd_export_markdown'], // Both commands now implemented
  stateSchemas: {
    conversationStore: 3,
    messageStore: 1,
  },
  persistenceSchemas: {
    conversations: 'musaed-conversation-storage-v2',
    messages: 'musaed-message-storage-v1',
  },
  dependencies: [], // No direct feature imports - uses coordination layer for conversation state
  coordinationLayerUsage: [
    'useCurrentConversationId',
    'useSetCurrentConversationId',
    'useSearchQuery',
    'useFilteredConversations',
    'useConversationActions',
    'useMessageStore',
    'ConversationMetadata',
  ],
} as const;
