'use client';

import { useCallback } from 'react';
import { useRagAssembleContext } from '@/features/rag';

/** RAG source citation shape stored on an assistant message. */
export type ChatRagSource = {
  filePath: string;
  startLine: number;
  endLine: number;
  language: string | undefined;
};

/** Result of assembling RAG context for a chat turn. */
export type ChatRagResult = {
  /** Citations flattened to the shape stored on Message.ragSources. */
  ragSources: ChatRagSource[] | undefined;
};

/**
 * RAG context assembly for the send pipeline. Owned by the conversation
 * feature so `useChatSend` doesn't reach across to the `rag` feature directly
 * beyond the already-declared `rag` dependency's public hook.
 *
 * Failures are swallowed — RAG is best-effort enrichment; a failed lookup MUST
 * NOT block the chat send (see useChatSend ragIntegration test).
 */
export function useChatRag(): {
  assembleChatRag: (query: string) => Promise<ChatRagResult>;
} {
  const { assembleContext } = useRagAssembleContext();

  const assembleChatRag = useCallback(
    async (query: string): Promise<ChatRagResult> => {
      const ragResult = await assembleContext(query);
      const ragSources = ragResult?.citations.map((s) => ({
        filePath: s.filePath,
        startLine: s.startLine,
        endLine: s.endLine,
        language: s.language ?? undefined,
      }));
      return { ragSources };
    },
    [assembleContext]
  );

  return { assembleChatRag };
}
