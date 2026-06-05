/**
 * Thinking-tag handling — single source of truth.
 *
 * Supports tag formats used by different reasoning models:
 * 1. <redacted-thinking>...</redacted-thinking>  (primary)
 * 2. <think>...</think>                          (DeepSeek-R1 fallback)
 * 3. <thoughts>...</thoughts>
 * 4. <reasoning>...</reasoning>
 * 5. <initial_thoughts>...</initial_thoughts>
 *
 * Both the synchronous path and the Web Worker blob consume these exports
 * so the regex pattern can never drift out of sync with the tag constants.
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

/** @deprecated Use THINKING_REGEX_SOURCE instead. Kept for backward compatibility. */
export const REDACTED_THINKING_REGEX_SOURCE = `${escapeRegExp(REDACTED_THINKING_TAG_START)}[\\s\\S]*?${escapeRegExp(REDACTED_THINKING_TAG_END)}`;

// ── Strip function ──────────────────────────────────────────────────

/**
 * Strips thinking blocks (all five tag formats) from content.
 * Single source of truth — the async worker variant reuses the same regex pattern.
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

/** @deprecated Use stripThinkingBlocks instead. Kept for backward compatibility. */
export function stripRedactedThinkingBlocks(content: string): string {
  return stripThinkingBlocks(content);
}

// ── Shared test vectors (JS + Rust must produce identical results) ──

/** Canonical test cases for thinking-block stripping parity. */
export const THINKING_STRIP_TEST_CASES: ReadonlyArray<{
  /** Human-readable description of what this case verifies */
  description: string;
  /** Raw input containing one or more thinking blocks */
  input: string;
  /** Expected output after all thinking blocks are stripped and trimmed */
  expected: string;
}> = [
  {
    description: 'strips <redacted-thinking> block',
    input: 'Hello<redacted-thinking>secret</redacted-thinking> World',
    expected: 'Hello World',
  },
  {
    description: 'strips <think> block (DeepSeek-R1)',
    input: 'Hello<think>reasoning content here</think> World',
    expected: 'Hello World',
  },
  {
    description: 'strips <thoughts> block',
    input: 'Prefix<thoughts>deep thoughts</thoughts>Suffix',
    expected: 'PrefixSuffix',
  },
  {
    description: 'strips <reasoning> block',
    input: 'Start<reasoning>chain of thought</reasoning>End',
    expected: 'StartEnd',
  },
  {
    description: 'strips <initial_thoughts> block',
    input: 'A<initial_thoughts>first idea</initial_thoughts>B',
    expected: 'AB',
  },
  {
    description: 'strips multiple blocks of different types',
    input: 'pre<redacted-thinking>a</redacted-thinking> mid<think>b</think> post',
    expected: 'pre mid post',
  },
  {
    description: 'strips nested/same-type blocks',
    input:
      'X<redacted-thinking>inner1</redacted-thinking>Y<redacted-thinking>inner2</redacted-thinking>Z',
    expected: 'XYZ',
  },
  {
    description: 'removes unclosed opening tag and everything after (redacted-thinking)',
    input: 'before<redacted-thinking>no closing tag',
    expected: 'before',
  },
  {
    description: 'removes unclosed opening tag and everything after (think)',
    input: 'before<think>no closing tag',
    expected: 'before',
  },
  {
    description: 'handles empty thinking block',
    input: 'A<redacted-thinking></redacted-thinking>B',
    expected: 'AB',
  },
  {
    description: 'preserves content with no thinking blocks',
    input: 'just plain text',
    expected: 'just plain text',
  },
  {
    description: 'trims whitespace around remaining content',
    input: ' <redacted-thinking>hidden</redacted-thinking> visible ',
    expected: 'visible',
  },
  {
    description: 'handles thinking block at start of string',
    input: '<redacted-thinking>reasoning</redacted-thinking>Actual Content',
    expected: 'Actual Content',
  },
  {
    description: 'handles thinking block at end of string',
    input: 'Actual Content<redacted-thinking>reasoning</redacted-thinking>',
    expected: 'Actual Content',
  },
  {
    description: 'handles multiline thinking block content',
    input: 'before<redacted-thinking>line1\nline2\nline3</redacted-thinking>after',
    expected: 'beforeafter',
  },
  {
    description: 'handles all five tag formats in one string',
    input:
      'a<redacted-thinking>r1</redacted-thinking>b<think>r2</think>c<thoughts>r3</thoughts>d<reasoning>r4</reasoning>e<initial_thoughts>r5</initial_thoughts>f',
    expected: 'abcdef',
  },
  {
    description: 'empty string returns empty',
    input: '',
    expected: '',
  },
  {
    description: 'only thinking blocks returns empty',
    input: '<redacted-thinking>all hidden</redacted-thinking>',
    expected: '',
  },
];

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
