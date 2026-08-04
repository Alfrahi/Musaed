// Conversation feature public API.
//
// Global Zustand stores (conversation-store, message-store, streaming-store)
// live in `@/store/`, not in this feature. Consumers import directly from
// `@/store/...`. See STANDARDS.md §3, §22.
export { useChatSend } from './hooks/useChatSend';
export { useConversationActions } from './hooks/useConversationActions';
export { useConversationInitialization } from './hooks/useConversationInitialization';
export { useAttachmentManager } from './hooks/useAttachmentManager';
export { useTauriEvents } from './hooks/useTauriEvents';
export { useAutoTitle, triggerAutoTitle } from './hooks/useAutoTitle';
export { useConversationMessages } from './hooks/useConversationMessages';
export { useTokenUsage } from './hooks/useTokenUsage';
export { useModelContextWindow } from './hooks/useModelContextWindow';
export { initializeConversations } from './utils/conversation-backend';
export { isDefaultTitle, generateConversationTitle } from './utils/title-generator';
export { attachmentImageSrc } from './image-attachment';
export { default as TokenContextBar } from './components/TokenContextBar';
export { default as ChatFeature } from './feature.manifest';
