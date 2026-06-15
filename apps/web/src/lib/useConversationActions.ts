/**
 * Conversation Actions Abstraction Layer
 * Provides controlled access to chat conversation functionality
 * without creating direct feature-to-feature coupling
 */
import { useConversationActions as useChatConversationActions } from '@/features/chat';

export function useConversationActions() {
  const chatActions = useChatConversationActions();

  // Return only the public API that other features should access
  return {
    createNewConversation: chatActions.createNewConversation,
    deleteConversation: chatActions.deleteConversation,
    updateConversationTitle: chatActions.updateConversationTitle,
    clearAllConversations: chatActions.clearAllConversations,
  };
}
