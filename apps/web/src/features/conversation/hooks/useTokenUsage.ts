'use client';

import { useMemo } from 'react';
import { useMessageStore } from '@/store/message-store';
import { useConversationStore } from '@/store/conversation-store';
import { useSettingsStore } from '@/store/settings-store';

export interface TokenUsageInfo {
  /** Total tokens used in the current conversation (prompt + completion). */
  usedTokens: number;
  /** Context window size from user settings (numCtx). */
  contextWindow: number;
  /** Usage ratio as a percentage (0-100). Returns 0 if no data. */
  percentage: number;
  /** Whether token usage data is available. */
  hasData: boolean;
}

/**
 * Hook that computes the current conversation's token usage for
 * context-window visualization. Reads the last assistant message's
 * `promptEvalCount` + `evalCount` from the message store.
 */
export function useTokenUsage(): TokenUsageInfo {
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const messages = useMessageStore((s) =>
    currentConversationId ? s.messages[currentConversationId] : undefined
  );
  const numCtx = useSettingsStore((s) => s.globalSettings.numCtx);

  return useMemo(() => {
    if (!currentConversationId || !messages || messages.length === 0) {
      return { usedTokens: 0, contextWindow: numCtx, percentage: 0, hasData: false };
    }

    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) {
      return { usedTokens: 0, contextWindow: numCtx, percentage: 0, hasData: false };
    }

    const promptTokens = lastAssistant.promptEvalCount ?? 0;
    const completionTokens = lastAssistant.evalCount ?? 0;
    const usedTokens = promptTokens + completionTokens;

    if (usedTokens === 0) {
      return { usedTokens: 0, contextWindow: numCtx, percentage: 0, hasData: false };
    }

    const percentage = Math.min(100, Math.round((usedTokens / numCtx) * 100));
    return { usedTokens, contextWindow: numCtx, percentage, hasData: true };
  }, [currentConversationId, messages, numCtx]);
}
