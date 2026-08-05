'use client';

import { useMemo } from 'react';
import { useMessageStore } from '@/store/message-store';
import { useConversationStore } from '@/store/conversation-store';
import { useSettingsStore } from '@/store/settings-store';
import { useModelContextWindow } from '@/features/library';

export interface TokenUsageInfo {
  /** Total tokens used in the current conversation (prompt + completion). */
  usedTokens: number;
  /** Resolved context window — model's `context_length` if available, else `numCtx` from settings. */
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
 *
 * The context-window denominator prefers the model's actual
 * `context_length` (fetched via `cmd_ollama_validate_model`), falling
 * back to the user's `numCtx` setting when unavailable.
 */
export function useTokenUsage(): TokenUsageInfo {
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const messages = useMessageStore((s) =>
    currentConversationId ? s.messages[currentConversationId] : undefined
  );
  const numCtx = useSettingsStore((s) => s.globalSettings.numCtx);
  const { contextWindow: modelContextWindow } = useModelContextWindow();

  const contextWindow = modelContextWindow ?? numCtx;

  return useMemo(() => {
    if (!currentConversationId || !messages || messages.length === 0) {
      return { usedTokens: 0, contextWindow, percentage: 0, hasData: false };
    }

    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) {
      return { usedTokens: 0, contextWindow, percentage: 0, hasData: false };
    }

    const promptTokens = lastAssistant.promptEvalCount ?? 0;
    const completionTokens = lastAssistant.evalCount ?? 0;
    const usedTokens = promptTokens + completionTokens;

    if (usedTokens === 0) {
      return { usedTokens: 0, contextWindow, percentage: 0, hasData: false };
    }

    const percentage = Math.min(100, Math.round((usedTokens / contextWindow) * 100));
    return { usedTokens, contextWindow, percentage, hasData: true };
  }, [currentConversationId, messages, contextWindow]);
}
