/**
 * Thinking-tag handling — single source of truth.
 *
 * Supports tag formats used by different reasoning models:
 * 1. <redacted-thinking>...</redacted-thinking>  (primary)
 * 2. <think>...</think>                          (DeepSeek-R1 fallback)
 * 3. <thoughts>...</thoughts>
 * 4. <reasoning>...</reasoning>
 * 5. <initial_thoughts>...</initial_thoughts>
 */

// ── Tag constants ───────────────────────────────────────────────────

export const REDACTED_THINKING_TAG_START = '<redacted-thinking>';
export const REDACTED_THINKING_TAG_END = '</redacted-thinking>';

/** DeepSeek-R1 style thinking tags */
export const THINK_TAG_START = '<think>';
export const THINK_TAG_END = '</think>';

/** Generic thoughts tags */
export const THOUGHTS_TAG_START = '<thoughts>';
export const THOUGHTS_TAG_END = '</thoughts>';

/** Reasoning tags */
export const REASONING_TAG_START = '<reasoning>';
export const REASONING_TAG_END = '</reasoning>';

/** Initial thoughts tags */
export const INITIAL_THOUGHTS_TAG_START = '<initial_thoughts>';
export const INITIAL_THOUGHTS_TAG_END = '</initial_thoughts>';

// ── Regex helpers ───────────────────────────────────────────────────

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Combined regex pattern source that matches **all** tag formats.
 * Injected into the worker blob to prevent drift — never duplicate the pattern.
 *
 * Matches:
 *   <redacted-thinking>...</redacted-thinking>
 *   <think>...</think>
 *   <thoughts>...</thoughts>
 *   <reasoning>...</reasoning>
 *   <initial_thoughts>...</initial_thoughts>
 */
export const THINKING_REGEX_SOURCE = [
  `${escapeRegExp(REDACTED_THINKING_TAG_START)}[\\s\\S]*?${escapeRegExp(REDACTED_THINKING_TAG_END)}`,
  `${escapeRegExp(THINK_TAG_START)}[\\s\\S]*?${escapeRegExp(THINK_TAG_END)}`,
  `${escapeRegExp(THOUGHTS_TAG_START)}[\\s\\S]*?${escapeRegExp(THOUGHTS_TAG_END)}`,
  `${escapeRegExp(REASONING_TAG_START)}[\\s\\S]*?${escapeRegExp(REASONING_TAG_END)}`,
  `${escapeRegExp(INITIAL_THOUGHTS_TAG_START)}[\\s\\S]*?${escapeRegExp(INITIAL_THOUGHTS_TAG_END)}`,
].join('|');

/**
 * Regex pattern source that matches **unclosed** thinking tags (opening tag
 * with no matching closing tag). Matches from the opening tag to end-of-string.
 *
 * Applied as a second pass after `THINKING_REGEX_SOURCE` so that partially
 * streamed or malformed content is also stripped.
 */
export const THINKING_UNCLOSED_REGEX_SOURCE = [
  `${escapeRegExp(REDACTED_THINKING_TAG_START)}[\\s\\S]*`,
  `${escapeRegExp(THINK_TAG_START)}[\\s\\S]*`,
  `${escapeRegExp(THOUGHTS_TAG_START)}[\\s\\S]*`,
  `${escapeRegExp(REASONING_TAG_START)}[\\s\\S]*`,
  `${escapeRegExp(INITIAL_THOUGHTS_TAG_START)}[\\s\\S]*`,
].join('|');

// ── Strip function ──────────────────────────────────────────────────

/**
 * Strips thinking blocks (all five tag formats) from content.
 *
 * Two-pass strategy:
 * 1. Remove all closed thinking blocks (opening + content + closing tag).
 * 2. Remove any remaining unclosed opening tags and everything after them
 *    (handles partially streamed or malformed content).
 */
export function stripThinkingBlocks(content: string): string {
  const closed = content.replace(new RegExp(THINKING_REGEX_SOURCE, 'gi'), '');
  const both = closed.replace(new RegExp(THINKING_UNCLOSED_REGEX_SOURCE, 'gi'), '');
  return both.trim();
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
 * Finds the first thinking block in `content`, supporting all
 * recognized thinking tag formats.
 *
 * Returns `null` if no thinking block is found.
 * During streaming, `closeTagLength` will be `-1` and `contentEnd`
 * will be the end of the string.
 */
export function findThinkingTags(content: string): ThinkingTagMatch | null {
  // Order matters: <redacted-thinking> first (primary), then others
  const matchers: Array<{ start: string; end: string }> = [
    { start: REDACTED_THINKING_TAG_START, end: REDACTED_THINKING_TAG_END },
    { start: THINK_TAG_START, end: THINK_TAG_END },
    { start: THOUGHTS_TAG_START, end: THOUGHTS_TAG_END },
    { start: REASONING_TAG_START, end: REASONING_TAG_END },
    { start: INITIAL_THOUGHTS_TAG_START, end: INITIAL_THOUGHTS_TAG_END },
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
