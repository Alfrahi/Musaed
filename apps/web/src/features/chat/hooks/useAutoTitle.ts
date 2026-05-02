"use client";

import { useCallback, useRef } from 'react';
import { Language } from '@musaed/contracts';
import { useConversationStore } from '../../../store/stores/conversation-store';
import { useSettingsStore } from '../../../store/stores/settings-store';
import { generateConversationTitle, isDefaultTitle } from '../utils/title-generator';
import { logger } from '../../../lib/logger';

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

    const state = useConversationStore.getState();
    const conversation = state.conversations[conversationId];
    if (!conversation) return;

    if (!isDefaultTitle(conversation.title)) return;

    const hasUser = conversation.messages.some(m => m.role === 'user');
    const hasAssistant = conversation.messages.some(m => m.role === 'assistant');
    if (!hasUser || !hasAssistant) return;

    pendingRef.current.add(conversationId);

    try {
      const ollamaUrl = useSettingsStore.getState().globalSettings.ollamaUrl;
      const lang = useSettingsStore.getState().globalSettings.language as Language;

      const title = await generateConversationTitle(conversation, ollamaUrl, lang);
      if (!title) return;

      // Re-check that the conversation still has the default title before updating
      const currentState = useConversationStore.getState();
      const currentConv = currentState.conversations[conversationId];
      if (!currentConv || !isDefaultTitle(currentConv.title)) return;

      useConversationStore.getState().batchUpdate(() => ({
        conversations: {
          ...currentState.conversations,
          [conversationId]: { ...currentConv, title, updatedAt: Date.now() },
        },
      }));

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
 */
export async function triggerAutoTitle(conversationId: string): Promise<void> {
  if (pendingAutoTitles.has(conversationId)) return;

  const state = useConversationStore.getState();
  const conversation = state.conversations[conversationId];
  if (!conversation) return;

  if (!isDefaultTitle(conversation.title)) return;

  const hasUser = conversation.messages.some(m => m.role === 'user');
  const hasAssistant = conversation.messages.some(m => m.role === 'assistant');
  if (!hasUser || !hasAssistant) return;

  pendingAutoTitles.add(conversationId);

  try {
    const settings = useSettingsStore.getState().globalSettings;
    const title = await generateConversationTitle(conversation, settings.ollamaUrl, settings.language);

    if (!title) return;

    const current = useConversationStore.getState().conversations[conversationId];
    if (!current || !isDefaultTitle(current.title)) return;

    useConversationStore.getState().batchUpdate(() => {
      const latest = useConversationStore.getState();
      return {
        conversations: {
          ...latest.conversations,
          [conversationId]: { ...latest.conversations[conversationId], title, updatedAt: Date.now() },
        },
      };
    });

    logger.info('Auto-generated conversation title', { conversationId, title });
  } catch (err) {
    logger.warn('Auto-title generation failed', { conversationId, error: err });
  } finally {
    pendingAutoTitles.delete(conversationId);
  }
}
