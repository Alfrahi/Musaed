'use client';

import { useCallback, useRef } from 'react';
import { useConversationStore } from '@/store/conversation-store';
import { useMessageStore } from '@/store/message-store';
import { useSettingsStore } from '@/store/settings-store';
import { conversationApi } from '@/lib/ipc';
import {
  generateConversationTitle,
  isDefaultTitle,
} from '@/features/conversation/utils/title-generator';
import { logger } from '@/lib/logger';

/** Module-level set tracking in-flight auto-title requests across all hook instances. */
export const pendingAutoTitles = new Set<string>();

type ConversationSnapshot = ReturnType<
  typeof useConversationStore.getState
>['conversations'][string];

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 150;

/** Retry conversation lookup to handle race conditions during initialization. */
async function lookupConversation(
  conversationId: string
): Promise<ConversationSnapshot | undefined> {
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    const state = useConversationStore.getState();
    const conversation = state.conversations[conversationId];
    if (conversation) return conversation;
    logger.warn('Auto-title: conversation not found in store, retrying', {
      conversationId,
      attempt: attempt + 1,
      totalAttempts: MAX_RETRY_ATTEMPTS,
      availableConversationIds: Object.keys(state.conversations),
    });
    if (attempt < MAX_RETRY_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  return undefined;
}

/**
 * Builds a deduplication key that binds pending state to a specific
 * conversation instance, not just its (recyclable) id.
 *
 * Auto-Title Race Condition: if a conversation is deleted and
 * a new conversation reuses the same id while a title generation is in
 * flight, using the bare `conversationId` as the dedup key could cause the
 * title generated for the old conversation to be applied to the new one.
 * Including `createdAt` ensures the key is unique per conversation instance.
 */
function dedupKey(conversationId: string, createdAt: number): string {
  return `${conversationId}:${createdAt}`;
}

/**
 * Core auto-generation logic shared by the hook and the imperative export.
 * Deduplicates via the given Set (module-level or per-hook ref).
 *
 * The dedup key is `${conversationId}:${createdAt}` so the pending state is
 * bound to a conversation *instance*, not a (possibly recycled) id.
 */
async function runAutoGenerate(conversationId: string, pending: Set<string>): Promise<void> {
  const conversation = await lookupConversation(conversationId);
  if (!conversation) {
    logger.error('Auto-title: conversation never appeared in store', { conversationId });
    return;
  }
  if (!isDefaultTitle(conversation.title)) {
    logger.info('Auto-title: conversation already has custom title', {
      conversationId,
      title: conversation.title,
    });
    return;
  }

  const key = dedupKey(conversationId, conversation.createdAt);
  if (pending.has(key)) return;

  const messages = useMessageStore.getState().messages[conversationId] || [];
  const hasUser = messages.some((m) => m.role === 'user');
  const hasAssistant = messages.some((m) => m.role === 'assistant');
  if (!hasUser || !hasAssistant) {
    logger.warn('Auto-title: missing user or assistant messages', {
      conversationId,
      messageCount: messages.length,
    });
    return;
  }

  pending.add(key);

  try {
    const settings = useSettingsStore.getState().globalSettings;
    const title = await generateConversationTitle(
      conversation,
      messages,
      settings.ollamaUrl,
      settings.language
    );
    if (!title) return;

    // Re-check that the conversation is still the same instance (same
    // createdAt) and still has the default title before updating. This
    // guards against the conversation being deleted and a new one reusing
    // the id during the await above.
    const current = useConversationStore.getState().conversations[conversationId];
    if (!current || current.createdAt !== conversation.createdAt) return;
    if (!isDefaultTitle(current.title)) return;

    useConversationStore.getState().updateConversation(conversationId, { title });
    conversationApi
      .updateConversation(conversationId, title, Date.now())
      .catch((e) => logger.error('Failed to persist auto-title:', { error: String(e) }));
    logger.info('Auto-generated conversation title', { conversationId, title });
  } catch (err) {
    logger.warn('Auto-title generation failed', { conversationId, error: err });
  } finally {
    pending.delete(key);
  }
}

/**
 * Hook that provides a function to auto-generate a conversation title.
 * Only generates for conversations that still have the default title.
 * Deduplicates in-flight requests globally.
 */
export function useAutoTitle() {
  const pendingRef = useRef(pendingAutoTitles);

  const generateTitle = useCallback(
    (conversationId: string) => runAutoGenerate(conversationId, pendingRef.current),
    []
  );

  return { generateTitle };
}

/**
 * Imperative version of auto-title generation for use outside React components
 * (e.g. event listeners). Shares the same deduplication set as `useAutoTitle`.
 */
export function triggerAutoTitle(conversationId: string): Promise<void> {
  return runAutoGenerate(conversationId, pendingAutoTitles);
}
