'use client';

import { stripThinkingBlocks, type Language, type Message } from '@musaed/contracts';
import { titleApi } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';
import type { ConversationMetadata } from '../../../store/stores/conversation-store';

/** Maximum characters to send for each message when generating a title. */
const MAX_MESSAGE_LENGTH = 500;

/** All localized variants of the default conversation title. */
const DEFAULT_TITLES: ReadonlySet<string> = new Set(['New Chat', 'محادثة جديدة']);

/**
 * Checks whether a conversation still has the default (un-renamed) title.
 * Works regardless of which locale was active when the conversation was created.
 */
export function isDefaultTitle(title: string): boolean {
  return DEFAULT_TITLES.has(title);
}

/**
 * Truncates a string to a maximum number of characters.
 */
function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

/**
 * Generates a short conversation title using the local Ollama model.
 *
 * Title cleaning (thinking-block stripping, reasoning detection, word-count
 * enforcement) is handled entirely by the Rust backend command
 * `cmd_ollama_generate_title`, which is the single source of truth.
 * Silently fails and returns null on any error so the UI is never disrupted.
 */
export async function generateConversationTitle(
  conversation: ConversationMetadata,
  messages: Message[],
  ollamaUrl: string,
  language: Language
): Promise<string | null> {
  const userMessage = messages.find((m) => m.role === 'user');
  const assistantMessage = messages.find((m) => m.role === 'assistant');

  if (!userMessage?.content || !assistantMessage?.content) return null;

  // Strip thinking blocks from the assistant message before sending it
  // so the model doesn't see reasoning content in the prompt.
  const cleanAssistantContent = stripThinkingBlocks(assistantMessage.content);

  try {
    const title = await titleApi.generate({
      baseUrl: ollamaUrl,
      model: conversation.model,
      userMessage: truncate(userMessage.content, MAX_MESSAGE_LENGTH),
      assistantMessage: truncate(cleanAssistantContent, MAX_MESSAGE_LENGTH),
      language,
    });

    // The Rust command returns a fully cleaned title (stripped, validated,
    // word-limited). No further processing needed on the client side.
    if (!title) return null;
    return title;
  } catch (err) {
    logger.warn('Title generation failed', { error: err });
    return null;
  }
}
