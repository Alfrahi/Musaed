import { callInternal } from './transport';
import type { Conversation, Message } from '@musaed/contracts';

/**
 * Conversation & Message APIs - manages conversation persistence operations.
 * - listConversations: fetches all conversations from backend storage
 * - getConversation: fetches a specific conversation by ID
 * - createConversation: creates a new conversation
 * - appendMessage: adds a message to a conversation
 * - deleteConversation: removes a conversation by ID
 * - clearAllConversations: removes all conversations
 */
export const conversationApi = {
  listConversations: () => callInternal('cmd_conversations_list', {}),
  getConversation: (id: string) => callInternal('cmd_conversation_get', { id }),
  createConversation: (conversation: Conversation) =>
    callInternal('cmd_conversation_create', { conversation }),
  appendMessage: (conversationId: string, message: Message) =>
    callInternal('cmd_message_append', { conversationId, message }),
  deleteMessage: (conversationId: string, messageId: string) =>
    callInternal('cmd_message_delete', { conversationId, messageId }),
  deleteConversation: (id: string) => callInternal('cmd_conversation_delete', { id }),
  clearAllConversations: () => callInternal('cmd_conversations_clear', {}),
  updateConversation: (id: string, title: string, updatedAt: number) =>
    callInternal('cmd_conversation_update', { id, title, updatedAt }),
  /**
   * Search messages across all conversations.
   * @param query - Search query string (min 1 char)
   * @param limit - Maximum number of results (1-100)
   * @returns Array of MessageSearchResult grouped by conversation
   */
  searchMessages: (query: string, limit: number) =>
    callInternal('cmd_conversation_search', { query, limit }),
};
