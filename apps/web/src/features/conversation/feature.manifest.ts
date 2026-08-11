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
      'useChatSend',
      'useConversationActions',
      'useConversationInitialization',
      'useConversationMessages',
      'usePersistActiveConversation',
      'useAttachmentManager',
      'useTauriEvents',
      'useAutoTitle',
      'triggerAutoTitle',
      'useTokenUsage',
    ],
    components: ['TokenContextBar'],
    utils: [
      'isDefaultTitle',
      'generateConversationTitle',
      'initializeConversations',
      'attachmentImageSrc',
    ],
  },
  ipcEndpoints: [
    'cmd_ollama_chat',
    'cmd_ollama_abort_chat',
    'cmd_ollama_generate_title',
    'cmd_conversation_create',
    'cmd_conversation_delete',
    'cmd_conversation_update',
    'cmd_conversation_get',
    'cmd_conversations_clear',
    'cmd_conversations_list',
    'cmd_message_append',
    'cmd_message_delete',
    // Attachment handling — `hooks/useAttachmentUtils.ts` opens native file
    // dialogs and reads file contents (images as base64, text as UTF-8) via
    // the IPC-layer `dialogApi`/`fsApi` namespaces. Feature-scoped, not shared.
    'cmd_dialog_open_file',
    'cmd_fs_read_file',
    'cmd_fs_read_text_file',
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
    background: ['cmd_ollama_generate_title'],
  },
  stateSchemas: {
    conversationStore: 3,
    messageStore: 0, // in-memory cache only, no persistence version
    // `streamingStore` is intentionally absent — it became fully in-memory
    // after Phase 3 #10 (persist middleware removed). STANDARDS §9 scopes
    // `stateSchemas` at cross-session persisted state, so versioning an
    // unpersisted buffer would be misleading. The validator skips entries
    // not declared here; a `streamingStore.ts` with no `VERSION` constant
    // and no `version:` field would otherwise fail extraction.
  },
  /**
   * Failure modes for this feature's IPC endpoints.
   *
   * @see STANDARDS.md §13 — Failure Mode Rule
   */
  failureModes: {
    cmd_ollama_chat: {
      fallback: 'Show error toast and keep user input intact for retry',
      retry: 'once',
      messageKey: 'error.chat.title',
    },
    cmd_ollama_abort_chat: {
      fallback: 'Silently ignore — abort is fire-and-forget',
      retry: 'none',
      messageKey: 'error.genericError',
    },
    cmd_ollama_generate_title: {
      fallback: 'Use default title — title generation is non-critical',
      retry: 'none',
      messageKey: 'error.genericError',
    },
    cmd_conversation_create: {
      fallback: 'Show error toast and keep the create dialog open',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_conversation_delete: {
      fallback: 'Show error toast; conversation remains in list',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_conversation_update: {
      fallback: 'Show error toast; title update remains in local state only',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_conversation_get: {
      fallback: 'Show error toast and redirect to conversation list',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_conversations_clear: {
      fallback: 'Show error toast; conversations remain in list',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_conversations_list: {
      fallback: 'Show empty conversation list with error banner',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_message_append: {
      fallback: 'Message is already displayed in UI; retry save in background',
      retry: 'exponential',
      messageKey: 'error.messageSaveFailed',
    },
    cmd_message_delete: {
      fallback: 'Old assistant message remains in UI; retry on next send',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_dialog_open_file: {
      fallback: 'Silently ignore — attachment picker is user-initiated',
      retry: 'none',
      messageKey: 'error.genericError',
    },
    cmd_fs_read_file: {
      fallback: 'Show error toast and skip the attachment',
      retry: 'once',
      messageKey: 'error.genericError',
    },
    cmd_fs_read_text_file: {
      fallback: 'Show error toast and skip the attachment',
      retry: 'once',
      messageKey: 'error.genericError',
    },
  },
  // `library` is a declared dependency because InputArea.tsx composes the
  // library feature's ModelSelector component into the chat input chrome.
  // `rag` is a declared dependency because MessageBubble renders RAG cite
  // affordances (FileChunkViewer modals).
  // dep-cruiser honors this list (see scripts/codegen-feature-deps.mjs).
  dependencies: ['library', 'rag'],
} as const;

export default manifest;
