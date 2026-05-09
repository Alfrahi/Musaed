'use client';

import { stripRedactedThinkingBlocks, type Language, type Message } from '@musaed/contracts';
import { titleApi } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';
import type { ConversationMetadata } from '../../../store/stores/conversation-store';

/** Maximum characters to send for each message when generating a title. */
const MAX_MESSAGE_LENGTH = 500;

/** Maximum number of words allowed in a generated title. */
const MAX_TITLE_WORDS = 5;

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
 * Cleans a generated title by stripping thinking/reasoning blocks,
 * taking only the last non-empty line (the actual title), and
 * enforcing the maximum word count.
 */
function cleanGeneratedTitle(raw: string): string {
  const stripped = stripRedactedThinkingBlocks(raw).trim();
  const lines = stripped
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const title = lines[lines.length - 1] ?? stripped;
  return truncateTitleWords(title, MAX_TITLE_WORDS);
}

/**
 * Truncates a title to at most `maxWords` words.
 * Preserves the leading portion which carries the most important content.
 */
function truncateTitleWords(title: string, maxWords: number): string {
  const words = title.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= maxWords) return title;
  return words.slice(0, maxWords).join(' ');
}

/**
 * Truncates a string to a maximum number of characters.
 */
function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

/**
 * Generates a short conversation title using the local Ollama model.
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

  const cleanAssistantContent = stripRedactedThinkingBlocks(assistantMessage.content);

  try {
    const rawTitle = await titleApi.generate({
      baseUrl: ollamaUrl,
      model: conversation.model,
      userMessage: truncate(userMessage.content, MAX_MESSAGE_LENGTH),
      assistantMessage: truncate(cleanAssistantContent, MAX_MESSAGE_LENGTH),
      language,
    });

    if (!rawTitle) return null;

    return cleanGeneratedTitle(rawTitle);
  } catch (err) {
    logger.warn('Title generation failed', { error: err });
    return null;
  }
}
