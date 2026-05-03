/**
 * Thinking-tag handling — single source of truth.
 *
 * Supports two tag formats used by different reasoning models:
 *   1. <redacted-thinking>...</redacted-thinking>  (primary)
 *   2. <thinkigne...</thinkigne>                  (DeepSeek-R1 fallback)
 *
 * Both the synchronous path and the Web Worker blob consume these exports
 * so the regex pattern can never drift out of sync with the tag constants.
 */

// ── Tag constants ───────────────────────────────────────────────────

export const REDACTED_THINKING_TAG_START = '<redacted-thinking>';
export const REDACTED_THINKING_TAG_END = '</redacted-thinking>';

/** DeepSeek-R1 style thinking tags */
export const THINK_TAG_START = '<thinkigne';
export const THINK_TAG_END = '</thinkigne';

// ── Regex helpers ───────────────────────────────────────────────────

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Combined regex pattern source that matches **both** tag formats.
 * Injected into the worker blob to prevent drift — never duplicate the pattern.
 *
 * Matches:
 *   <redacted-thinking>...</redacted-thinking>
 *   <thinkigne...</thinkigne>
 */
export const THINKING_REGEX_SOURCE = [
  `${escapeRegExp(REDACTED_THINKING_TAG_START)}[\\s\\S]*?${escapeRegExp(REDACTED_THINKING_TAG_END)}`,
  `${escapeRegExp(THINK_TAG_START)}[\\s\\S]*?${escapeRegExp(THINK_TAG_END)}`,
].join('|');

/** @deprecated Use THINKING_REGEX_SOURCE instead. Kept for backward compatibility. */
export const REDACTED_THINKING_REGEX_SOURCE = `${escapeRegExp(REDACTED_THINKING_TAG_START)}[\\s\\S]*?${escapeRegExp(REDACTED_THINKING_TAG_END)}`;

// ── Strip function ──────────────────────────────────────────────────

/**
 * Strips thinking blocks (both tag formats) from content.
 * Single source of truth — the async worker variant reuses the same regex pattern.
 */
export function stripThinkingBlocks(content: string): string {
  return content.replace(new RegExp(THINKING_REGEX_SOURCE, 'gi'), '').trim();
}

/** @deprecated Use stripThinkingBlocks instead. Kept for backward compatibility. */
export function stripRedactedThinkingBlocks(content: string): string {
  return stripThinkingBlocks(content);
}

// ── Tag finder ──────────────────────────────────────────────────────

export interface ThinkingTagMatch {
  /** Index where the thinking content starts (after the opening tag) */
  contentStart: number;
  /** Index where the thinking content ends (at the start of the closing tag, or end of string if streaming) */
  contentEnd: number;
  /** Index where the opening tag starts in the source string */
  tagStart: number;
  /** Length of the closing tag; -1 if not yet closed (streaming) */
  closeTagLength: number;
  /** Total length of the opening tag */
  openTagLength: number;
}

/**
 * Finds the first thinking block in `content`, supporting both
 * `<redacted-thinking>` and `<thinkigne` tag formats.
 *
 * Returns `null` if no thinking block is found.
 * During streaming, `closeTagLength` will be `-1` and `contentEnd`
 * will be the end of the string.
 */
export function findThinkingTags(content: string): ThinkingTagMatch | null {
  // Try <redacted-thinking> first (primary), then <thinkigne (fallback)
  const matchers: Array<{ start: string; end: string }> = [
    { start: REDACTED_THINKING_TAG_START, end: REDACTED_THINKING_TAG_END },
    { start: THINK_TAG_START, end: THINK_TAG_END },
  ];

  for (const { start, end } of matchers) {
    const tagStart = content.indexOf(start);
    if (tagStart === -1) continue;

    const openTagLength = start.length;
    const contentStart = tagStart + openTagLength;

    const closeIdx = content.indexOf(end, contentStart);
    const isFinished = closeIdx !== -1;

    return {
      tagStart,
      contentStart,
      contentEnd: isFinished ? closeIdx : content.length,
      openTagLength,
      closeTagLength: isFinished ? end.length : -1,
    };
  }

  return null;
}
