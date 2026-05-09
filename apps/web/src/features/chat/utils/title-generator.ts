'use client';

import { stripRedactedThinkingBlocks, type Language, type Message } from '@musaed/contracts';
import { titleApi } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';
import type { ConversationMetadata } from '../../../store/stores/conversation-store';

/** Maximum characters to send for each message when generating a title. */
const MAX_MESSAGE_LENGTH = 500;

/** Maximum number of words allowed in a generated title. */
const MAX_TITLE_WORDS = 5;

/** Prefixes indicating the model started reasoning instead of generating a title. */
const REASONING_STARTERS = [
  'okay',
  'alright',
  'let me',
  "let's",
  'i need',
  'i think',
  "i'll",
  'first',
  'so,',
  'so i',
  'well,',
  'the user',
  'based on',
  'to answer',
  'in order',
  'sure,',
  'sure i',
  'certainly',
  'of course',
  "here's",
  'here is',
] as const;

/**
 * Returns true if the text looks like a reasoning/sentence output
 * rather than a concise title label.
 */
function looksLikeReasoning(text: string): boolean {
  const lower = text.toLowerCase();
  return REASONING_STARTERS.some((starter) => lower.startsWith(starter));
}

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
 *
 * Returns null if the output looks like reasoning instead of a title.
 */
function cleanGeneratedTitle(raw: string): string | null {
  const stripped = stripRedactedThinkingBlocks(raw).trim();
  const lines = stripped
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const title = lines[lines.length - 1] ?? stripped;

  if (looksLikeReasoning(title)) return null;

  return truncateTitleWords(title, MAX_TITLE_WORDS);
}

/**
 * Enforces the word-count limit on a generated title.
 *
 * When a model ignores the prompt and produces a sentence instead of a label,
 * blindly taking the first N words yields poor results (e.g.
 * "ChatGPT: Large Language Model from"). Instead, we look for natural
 * separators (colon, dash) and prefer the concise portion before it.
 */
function truncateTitleWords(title: string, maxWords: number): string {
  const words = title.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= maxWords) return title;

  // Titles like "ChatGPT: Large Language Model from OpenAI" — the part
  // before the colon is the concise label.
  const colonIdx = title.indexOf(':');
  if (colonIdx !== -1) {
    const before = title.slice(0, colonIdx).trim();
    const beforeWords = before.split(/\s+/).filter((w) => w.length > 0);
    if (beforeWords.length > 0 && beforeWords.length <= maxWords) {
      return before;
    }
  }

  // Titles like "ChatGPT - Large Language Model" — same idea with dashes.
  const dashIdx = title.indexOf(' - ');
  if (dashIdx !== -1) {
    const before = title.slice(0, dashIdx).trim();
    const beforeWords = before.split(/\s+/).filter((w) => w.length > 0);
    if (beforeWords.length > 0 && beforeWords.length <= maxWords) {
      return before;
    }
  }

  // Fallback: take first N words (better than an overly long title).
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
