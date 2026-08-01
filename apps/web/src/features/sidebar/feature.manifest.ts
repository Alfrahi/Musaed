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
  ipcEndpoints: ['cmd_dialog_ask'],
  stateSchemas: {
    // Both `conversationStore` and `messageStore` are owned by the
    // `conversation` feature. Sidebar reads them to render the conversation
    // list but does not own their schemas.
  },
  /**
   * Failure modes for this feature's IPC endpoints.
   *
   * @see STANDARDS.md §13 — Failure Mode Rule
   */
  failureModes: {
    cmd_dialog_ask: {
      fallback: 'Treat as user cancellation — no action taken',
      retry: 'none',
      messageKey: 'error.genericError',
    },
  },
  // Sidebar is the conversation-list composition layer. It imports from
  // conversation (display + actions), rag (project browser), and settings
  // (i18n + theme) — declared here so dep-cruiser honors them as the
  // manifest-driven dependency contract (see scripts/codegen-feature-deps.mjs).
  // Store getters (useLanguage, useSettingsStore, …) live in `@/store` and
  // cross-feature *store* access is not a feature-import for these purposes.
  dependencies: ['conversation', 'rag'],
} as const;

export default manifest;
