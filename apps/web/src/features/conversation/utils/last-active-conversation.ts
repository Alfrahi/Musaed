'use client';

/**
 * Storage key for the last active conversation ID
 */
const LAST_ACTIVE_CONVERSATION_KEY = 'lastActiveConversationId';

/**
 * Get the last active conversation ID from localStorage
 * @returns The last active conversation ID or null if not found
 */
export function getLastActiveConversationId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return localStorage.getItem(LAST_ACTIVE_CONVERSATION_KEY);
}

/**
 * Set the last active conversation ID in localStorage
 * @param conversationId - The conversation ID to persist
 */
export function setLastActiveConversationId(conversationId: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.setItem(LAST_ACTIVE_CONVERSATION_KEY, conversationId);
}

/**
 * Clear the last active conversation ID from localStorage
 */
export function clearLastActiveConversationId(): void {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.removeItem(LAST_ACTIVE_CONVERSATION_KEY);
}
