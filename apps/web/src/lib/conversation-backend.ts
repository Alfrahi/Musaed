import { conversationApi } from './ipc';
import type { Conversation, Message } from '@musaed/contracts';

/**
 * Conversation Backend Service
 *
 * This module provides a layer between the frontend stores and the Rust backend.
 * It handles all communication with the backend for conversation and message persistence.
 */

// Type for conversation metadata (without messages)
export type ConversationMetadata = Omit<Conversation, 'messages'>;

/**
 * Initialize conversations from backend storage
 * This should be called once on app startup to load all conversations
 */
export async function initializeConversations(): Promise<ConversationMetadata[] | null> {
  try {
    const result = await conversationApi.listConversations();
    if (result) {
      // Return only conversation metadata (without messages)
      return result.map(({ messages: _messages, ...metadata }) => metadata);
    }
    return null;
  } catch (error) {
    console.error('Failed to initialize conversations from backend:', error);
    return null;
  }
}

/**
 * Load a full conversation with messages from backend
 * @param id The conversation ID to load
 */
export async function loadConversation(id: string): Promise<Conversation | null> {
  try {
    const result = await conversationApi.getConversation(id);
    return result;
  } catch (error) {
    console.error(`Failed to load conversation ${id} from backend:`, error);
    return null;
  }
}

/**
 * Create a new conversation in backend storage
 * @param conversation The conversation to create
 */
export async function createConversation(conversation: Conversation): Promise<string | null> {
  try {
    const result = await conversationApi.createConversation(conversation);
    return result;
  } catch (error) {
    console.error('Failed to create conversation in backend:', error);
    return null;
  }
}

/**
 * Add a message to a conversation in backend storage
 * @param conversationId The conversation ID
 * @param message The message to add
 */
export async function addMessage(conversationId: string, message: Message): Promise<boolean> {
  try {
    await conversationApi.appendMessage(conversationId, message);
    return true;
  } catch (error) {
    console.error(`Failed to add message to conversation ${conversationId} in backend:`, error);
    return false;
  }
}

/**
 * Delete a conversation from backend storage
 * @param id The conversation ID to delete
 */
export async function deleteConversation(id: string): Promise<boolean> {
  try {
    await conversationApi.deleteConversation(id);
    return true;
  } catch (error) {
    console.error(`Failed to delete conversation ${id} from backend:`, error);
    return false;
  }
}

/**
 * Clear all conversations from backend storage
 */
export async function clearAllConversations(): Promise<boolean> {
  try {
    await conversationApi.clearAllConversations();
    return true;
  } catch (error) {
    console.error('Failed to clear all conversations from backend:', error);
    return false;
  }
}
