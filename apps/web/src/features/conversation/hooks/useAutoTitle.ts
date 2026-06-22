'use client';

import { useCallback, useRef } from 'react';
import { useConversationStore } from '@/features/conversation/store/conversation-store';
import { useMessageStore } from '@/features/conversation/store/message-store';
import { useSettingsStore } from '@/features/settings/store/settings-store';
import { updateConversation as backendUpdateConversation } from '@/features/conversation/utils/conversation-backend';
import {
  generateConversationTitle,
  isDefaultTitle,
} from '@/features/conversation/utils/title-generator';
import { logger } from '@/lib/logger';

/** Module-level set tracking in-flight auto-title requests across all hook instances. */
const pendingAutoTitles = new Set<string>();

/**
 * Hook that provides a function to auto-generate a conversation title.
 * Only generates for conversations that still have the default title.
 * Deduplicates in-flight requests globally.
 */
export function useAutoTitle() {
  const pendingRef = useRef(pendingAutoTitles);

  const generateTitle = useCallback(async (conversationId: string) => {
    if (pendingRef.current.has(conversationId)) return;

    // Retry conversation lookup to handle race conditions during initialization
    let conversation:
      | ReturnType<typeof useConversationStore.getState>['conversations'][string]
      | undefined;
    let attempts = 0;
    const maxAttempts = 5; // Increased from 3 to 5 for slower initialization scenarios

    while (attempts < maxAttempts) {
      const state = useConversationStore.getState();
      conversation = state.conversations[conversationId];
      if (conversation) break;
      attempts++;
      logger.warn('Auto-title: conversation not found in store, retrying', {
        conversationId,
        attempt: attempts,
        totalAttempts: maxAttempts,
        availableConversationIds: Object.keys(state.conversations),
      });
      if (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 150)); // Increased from 100ms
      }
    }

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

    pendingRef.current.add(conversationId);

    try {
      const ollamaUrl = useSettingsStore.getState().globalSettings.ollamaUrl;
      const lang = useSettingsStore.getState().globalSettings.language;

      const title = await generateConversationTitle(conversation, messages, ollamaUrl, lang);
      if (!title) return;

      // Re-check that the conversation still has the default title before updating
      const currentState = useConversationStore.getState();
      const currentConv = currentState.conversations[conversationId];
      if (!currentConv || !isDefaultTitle(currentConv.title)) return;

      useConversationStore.getState().updateConversation(conversationId, { title });
      backendUpdateConversation(conversationId, title, Date.now()).catch((e) =>
        console.error('Failed to persist auto-title:', e)
      );
      logger.info('Auto-generated conversation title', { conversationId, title });
    } catch (err) {
      logger.warn('Auto-title generation failed', { conversationId, error: err });
    } finally {
      pendingRef.current.delete(conversationId);
    }
  }, []);

  return { generateTitle };
}

/**
 * Imperative version of auto-title generation for use outside React components
 * (e.g. event listeners). Shares the same deduplication set as `useAutoTitle`.
 * Retries conversation lookup up to 5 times with 150ms delay to handle
 * race conditions during app initialization.
 */
export async function triggerAutoTitle(conversationId: string): Promise<void> {
  if (pendingAutoTitles.has(conversationId)) return;

  // Retry conversation lookup to handle race conditions during initialization
  let conversation:
    | ReturnType<typeof useConversationStore.getState>['conversations'][string]
    | undefined;
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    const state = useConversationStore.getState();
    conversation = state.conversations[conversationId];
    if (conversation) break;
    attempts++;
    logger.warn('Auto-title: conversation not found in store, retrying', {
      conversationId,
      attempt: attempts,
      totalAttempts: maxAttempts,
      availableConversationIds: Object.keys(state.conversations),
    });
    if (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

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

  pendingAutoTitles.add(conversationId);

  try {
    const settings = useSettingsStore.getState().globalSettings;
    logger.info('Auto-title: starting title generation', {
      conversationId,
      model: conversation.model,
      language: settings.language,
    });
    const title = await generateConversationTitle(
      conversation,
      messages,
      settings.ollamaUrl,
      settings.language
    );
    if (!title) {
      logger.warn('Auto-title: title generation returned null', { conversationId });
      return;
    }

    const current = useConversationStore.getState().conversations[conversationId];
    if (!current || !isDefaultTitle(current.title)) return;

    useConversationStore.getState().updateConversation(conversationId, { title });
    backendUpdateConversation(conversationId, title, Date.now()).catch((e) =>
      console.error('Failed to persist auto-title:', e)
    );
    logger.info('Auto-generated conversation title', { conversationId, title });
  } catch (err) {
    logger.warn('Auto-title generation failed', { conversationId, error: err });
  } finally {
    pendingAutoTitles.delete(conversationId);
  }
}
