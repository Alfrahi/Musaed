import { useState, useCallback } from 'react';
import { stripThinkingBlocks, type Message } from '@musaed/contracts';

/**
 * Hook for handling message copy operations with feedback.
 *
 * `overrideText` lets callers copy something other than the full message
 * (e.g. the user's current text selection captured by the context menu).
 */
export function useMessageActions(message: Message) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (overrideText?: string) => {
      const selected = overrideText?.trim() ? overrideText : '';
      const cleanContent = selected || stripThinkingBlocks(message.content);
      navigator.clipboard.writeText(cleanContent || message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    [message.content]
  );

  const tps =
    message.evalCount != null && message.evalDuration != null && message.evalDuration > 0
      ? message.evalCount / (message.evalDuration / 1e9)
      : 0;

  return {
    copied,
    handleCopy,
    tps,
  };
}
