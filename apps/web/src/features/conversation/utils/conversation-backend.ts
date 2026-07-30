import { conversationApi } from '@/lib/ipc';
import type { Conversation } from '@musaed/contracts';
import { logger } from '@/lib/logger';

/** Conversation metadata (without messages). */
export type ConversationMetadata = Omit<Conversation, 'messages'>;

/**
 * Initialize conversations from backend storage.
 * Called once on app startup to load all conversations.
 */
export async function initializeConversations(): Promise<ConversationMetadata[] | null> {
  try {
    const result = await conversationApi.listConversations();
    if (result) {
      return result.map(({ messages: _messages, ...metadata }) => metadata);
    }
    return null;
  } catch (error) {
    logger.error('Failed to initialize conversations from backend:', { error: String(error) });
    return null;
  }
}
