"use client";

import { stripRedactedThinkingBlocks, Conversation, Language } from '@musaed/contracts';
import { titleApi } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';

/** Maximum characters to send for each message when generating a title. */
const MAX_MESSAGE_LENGTH = 500;

/** All localized variants of the default conversation title. */
const DEFAULT_TITLES: ReadonlySet<string> = new Set([
  'New Chat',
  'محادثة جديدة',
]);

/**
 * Checks whether a conversation still has the default (un-renamed) title.
 * Works regardless of which locale was active when the conversation was created.
 */
export function isDefaultTitle(title: string): boolean {
  return DEFAULT_TITLES.has(title);
}

/**
 * Cleans a generated title by stripping thinking/reasoning blocks and
 * taking only the last non-empty line (the actual title).
 */
function cleanGeneratedTitle(raw: string): string {
  const stripped = stripRedactedThinkingBlocks(raw).trim();
  const lines = stripped.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  return lines[lines.length - 1] ?? stripped;
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
  conversation: Conversation,
  ollamaUrl: string,
  language: Language,
): Promise<string | null> {
  const messages = conversation.messages;

  const userMessage = messages.find(m => m.role === 'user');
  const assistantMessage = messages.find(m => m.role === 'assistant');

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
