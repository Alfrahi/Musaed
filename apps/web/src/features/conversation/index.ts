// Conversation feature public API.
//
// Global Zustand stores (conversation-store, message-store, streaming-store)
// live in `@/store/`, not in this feature. Consumers import directly from
// `@/store/...`. See STANDARDS.md §3, §22.
export { useChatSend } from './hooks/useChatSend';
export { useConversationActions } from './hooks/useConversationActions';
export { useConversationInitialization } from './hooks/useConversationInitialization';
// Public stop primitive consumed by the global Escape-to-stop shortcut
// (useGlobalShortcuts) and InputArea. Barrel-exported so non-feature
// callers don't deep-import into feature internals (STANDARDS §3).
export { abortStreaming } from './hooks/useConversationActions';
export { useAttachmentManager } from './hooks/useAttachmentManager';
export { useTauriEvents } from './hooks/useTauriEvents';
export { useAutoTitle, triggerAutoTitle } from './hooks/useAutoTitle';
export { useConversationMessages } from './hooks/useConversationMessages';
export { initializeConversations } from './utils/conversation-backend';
export { isDefaultTitle, generateConversationTitle } from './utils/title-generator';
export { attachmentImageSrc } from './image-attachment';
export { default as ChatFeature } from './feature.manifest';
