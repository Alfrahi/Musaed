'use client';

import { useCurrentConversationId } from '@/store/conversation-store';
import { useChatSend } from './useChatSend';
import { useChatStream } from './useChatStream';

/**
 * Chat actions public facade. Composes the three hooks split out of the former
 * God hook (audit F4 — `useChatActions` was 307 lines, 7 stores, 2 IPC APIs):
 *
 * - `useChatSend`     — send pipeline (validate → RAG → messages → chatApi → persist)
 * - `useChatStream`   — streaming-failure error handling + abort
 * - `useChatRag`      — RAG context assembly + citation mapping (consumed by useChatSend)
 *
 * The public surface (`sendMessage`, `abortMessage`) is preserved so consumers
 * (useChatInput, ChatWindow) and the existing test suite are unaffected.
 */
export const useChatActions = () => {
  const { sendMessage } = useChatSend();
  const { abortMessage } = useChatStream();
  const currentConversationId = useCurrentConversationId();

  // `abortMessage` needs the current conversation id at call time. We close
  // over it here so callers keep the no-arg signature (`abortMessage()`).
  const abortMessageCurrent = () => abortMessage(currentConversationId);

  return { sendMessage, abortMessage: abortMessageCurrent };
};
