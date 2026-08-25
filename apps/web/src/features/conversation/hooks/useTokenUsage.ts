'use client';

import { useMemo } from 'react';
import { useMessageStore } from '@/store/message-store';
import { useConversationStore } from '@/store/conversation-store';
import { useResolvedModelParams } from '@/store/model-params-store';
import { useSelectedModel } from '@/store/model-store';
import { useModelContextWindow } from '@/features/library';

export interface TokenUsageInfo {
  /** Prompt tokens used in the current context window (from last assistant turn). */
  usedTokens: number;
  /** Resolved context window — exactly the `numCtx` the next request will send. */
  contextWindow: number;
  /** Usage ratio as a percentage (0-100). Returns 0 if no data. */
  percentage: number;
  /** Whether token usage data is available. */
  hasData: boolean;
}

/**
 * Hook that computes the current conversation's token usage for
 * context-window visualization. Reads the last assistant message's
 * `promptEvalCount` from the message store — this is the number of
 * tokens Ollama consumed as input (system prompt + history + RAG +
 * current user message) and directly reflects how full the context
 * window is. Completion tokens (`evalCount`) are excluded because they
 * become part of the next turn's `promptEvalCount` — counting them
 * separately would double-count.
 *
 * The denominator comes solely from `useResolvedModelParams` — the same
 * resolution path ChatSendService uses — so the HUD always shows the
 * `numCtx` the next request actually sends (override applied, clamped to
 * the real window), never raw `/api/show` metadata.
 *
 * Usage numbers only count when the newest assistant turn was produced
 * by the currently selected model; switching models resets the HUD to
 * empty until a turn completes under the new selection.
 */
export function useTokenUsage(): TokenUsageInfo {
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const messages = useMessageStore((s) =>
    currentConversationId ? s.messages[currentConversationId] : undefined
  );
  const selectedModel = useSelectedModel();
  const { contextWindow: modelContextWindow, defaultParams } = useModelContextWindow();
  const resolved = useResolvedModelParams(selectedModel, modelContextWindow, defaultParams);
  const contextWindow = resolved.numCtx;

  return useMemo(() => {
    if (!contextWindow || contextWindow <= 0) {
      return { usedTokens: 0, contextWindow: 0, percentage: 0, hasData: false };
    }

    if (!currentConversationId || !messages || messages.length === 0) {
      return { usedTokens: 0, contextWindow, percentage: 0, hasData: false };
    }

    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) {
      return { usedTokens: 0, contextWindow, percentage: 0, hasData: false };
    }

    // Stale-model guard: metrics from a different (or unknown) model say
    // nothing about the current request's window — hide them instead.
    if (!lastAssistant.model || lastAssistant.model !== selectedModel) {
      return { usedTokens: 0, contextWindow, percentage: 0, hasData: false };
    }

    const usedTokens = lastAssistant.promptEvalCount ?? 0;

    if (usedTokens === 0) {
      return { usedTokens: 0, contextWindow, percentage: 0, hasData: false };
    }

    const percentage = Math.min(100, Math.round((usedTokens / contextWindow) * 100));
    return { usedTokens, contextWindow, percentage, hasData: true };
  }, [currentConversationId, messages, contextWindow, selectedModel]);
}
