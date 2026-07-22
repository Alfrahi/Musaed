// Conversation feature public API.
//
// Global Zustand stores (conversation-store, message-store, streaming-store)
// live in `@/store/`, not in this feature, because sidebar/settings/layout all
// depend on them. This barrel re-exports their public selectors so non-feature
// callers can still reach them via the documented public surface. Feature
// callers should import directly from `@/store/...`. See STANDARDS.md §22.
export * from '@/store/conversation-store';
export * from '@/store/message-store';
export * from '@/store/streaming-store';
export { useChatActions } from './hooks/useChatActions';
export { useConversationActions } from './hooks/useConversationActions';
export { useAttachmentManager } from './hooks/useAttachmentManager';
export { useTauriEvents } from './hooks/useTauriEvents';
export { useAutoTitle, triggerAutoTitle } from './hooks/useAutoTitle';
export { useConversationMessages } from './hooks/useConversationMessages';
export { initializeConversations } from './utils/conversation-backend';
export { isDefaultTitle, generateConversationTitle } from './utils/title-generator';
export { default as ChatFeature } from './feature.manifest';
