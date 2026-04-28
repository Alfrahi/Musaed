import { useState, useCallback } from 'react';
import { stripRedactedThinkingBlocks, Message } from '@musaed/contracts';

/**
 * Hook for handling message copy operations with feedback.
 */
export function useMessageActions(message: Message) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const cleanContent = stripRedactedThinkingBlocks(message.content);
    navigator.clipboard.writeText(cleanContent || message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  const durationNs = message.eval_duration || message.total_duration || 0;
  const tps = message.eval_count !== undefined && durationNs > 0 ? (message.eval_count / (durationNs / 1e9)) : 0;

  return {
    copied,
    handleCopy,
    tps
  };
}
