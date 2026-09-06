import { callInternal } from './transport';
import type { CommandMap } from '@musaed/contracts';

/**
 * Chat & Interaction API - handles streaming chat and abort control.
 * - chat: initiates a streaming chat request (stream handled separately)
 * - abort: cancels an ongoing chat by requestId
 */
export const chatApi = {
  /**
   * Initiates a chat completion. Returns immediately with boolean; streaming handled via events.
   * @param args - Chat arguments including messages, model, options, and requestId
   * @returns true if request was accepted, false if blocked/validation failed
   */
  chat: (args: CommandMap['cmd_ollama_chat']['args']) => callInternal('cmd_ollama_chat', args),
  /**
   * Aborts an in-progress chat request.
   * @param requestId - The request identifier returned from the chat call
   */
  abort: (requestId: string) => callInternal('cmd_ollama_abort_chat', { requestId }),
};
