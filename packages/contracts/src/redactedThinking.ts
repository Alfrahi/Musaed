/**
 * Redacted-thinking tag handling — single source of truth.
 *
 * Both the synchronous path and the Web Worker blob consume these exports
 * so the regex pattern can never drift out of sync with the tag constants.
 */

export const REDACTED_THINKING_TAG_START = '<redacted-thinking>';
export const REDACTED_THINKING_TAG_END = '</redacted-thinking>';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Regex pattern source derived from the tag constants.
 * Injected into the worker blob to prevent drift — never duplicate the pattern.
 */
export const REDACTED_THINKING_REGEX_SOURCE =
  `${escapeRegExp(REDACTED_THINKING_TAG_START)}[\\s\\S]*?${escapeRegExp(REDACTED_THINKING_TAG_END)}`;

/**
 * Strips redacted-thinking blocks from content.
 * Single source of truth — the async worker variant reuses the same regex pattern.
 */
export function stripRedactedThinkingBlocks(content: string): string {
  return content.replace(new RegExp(REDACTED_THINKING_REGEX_SOURCE, 'gi'), '').trim();
}
