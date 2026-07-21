/**
 * Sidebar Feature Manifest
 * Defines public API, IPC endpoints, and dependencies.
 *
 * Coordination layer usage (documented, not part of the typed contract):
 *   useCurrentConversationId, useSetCurrentConversationId, useSearchQuery,
 *   useFilteredConversations, useConversationActions, useMessageStore,
 *   ConversationMetadata
 */

import type { FeatureManifest } from '@musaed/contracts';

const manifest: FeatureManifest = {
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
} as const;

export default manifest;
