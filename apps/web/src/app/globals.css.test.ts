import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS_PATH = resolve(__dirname, 'globals.css');

function loadCss(): string {
  return readFileSync(CSS_PATH, 'utf8');
}

describe('globals.css focus-ring utility (STANDARDS.md §13)', () => {
  const css = loadCss();

  it('declares a .focus-ring @utility with a visible focus-visible ring', () => {
    // The `.focus-ring` utility replaces the former global `:focus-visible`
    // rule. It must apply a visible ring (not `none`) on `:focus-visible`.
    const blockMatch = css.match(/@utility\s+focus-ring\s*\{([^}]*)\}/);
    expect(blockMatch, '@utility focus-ring must exist in globals.css').not.toBeNull();
    const block = blockMatch![1];

    // Must include focus-visible:ring-2 (the canonical ring width).
    expect(/focus-visible:ring-2/.test(block)).toBe(true);
    // Must include focus-visible:ring-blue-500 (the canonical ring color).
    expect(/focus-visible:ring-blue-500/.test(block)).toBe(true);
    // Must include focus-visible:outline-none (suppress the default outline
    // so the ring is the sole focus indicator).
    expect(/focus-visible:outline-none/.test(block)).toBe(true);
  });

  it('does not declare a bare `:focus-visible { outline: ... }` global rule', () => {
    // The global :focus-visible rule was removed because it fired on
    // programmatic .focus() calls (e.g. the active conversation row on
    // launch), causing a blue outline flash. Focus styling is now handled
    // exclusively by the `.focus-ring` utility on elements that need it.
    const globalRuleMatch = css.match(/(^|\n)\s*:focus-visible\s*\{[^}]*\}/);
    expect(globalRuleMatch, ':focus-visible global rule must not exist').toBeNull();
  });
});

describe('globals.css typography utilities (STANDARDS.md §13 — WCAG 1.4.3)', () => {
  const css = loadCss();

  it('does not declare a global `letter-spacing: 0 !important`', () => {
    // The previous suppression both globally stamped letter-spacing to 0 AND
    // neutered Tailwind's `tracking-{tighter,tight,normal,wide,wider,widest}`
    // utilities — the eyebrow micro-labels across the app leaned on those for
    // legibility. Both regressions are guarded here.
    expect(/letter-spacing\s*:\s*0\s*!important/i.test(css)).toBe(false);
  });

  it('does not re-introduce the `--tracking-*: 0` token overrides inside @theme', () => {
    // Strip comments so a stray `//` doc reference doesn't trip the assertion.
    const themeBlockMatch = css.match(/@theme\s*\{([^}]*)\}/);
    expect(themeBlockMatch, '@theme block must exist').not.toBeNull();
    const themeBlock = themeBlockMatch![1];
    expect(/--tracking-\w+\s*:\s*0/.test(themeBlock)).toBe(false);
  });

  it('declares the caption-* size theme variables (`--text-caption-xs` 12px, `--text-caption-md` 13px)', () => {
    // These variables back the `@utility caption-xs` / `caption-md` declarations
    // and are the contract the call-site sweep relies on. Pair them so a future
    // rename is forced to update both in lockstep.
    expect(/--text-caption-xs:\s*12px/.test(css)).toBe(true);
    expect(/--text-caption-md:\s*13px/.test(css)).toBe(true);
  });

  it('declares the `caption-xs` and `caption-md` utilities with WCAG-1.4.3-safe zinc shades', () => {
    // The utilities are opinionated about color so micro-labels are safe-by-
    // default: zinc-600 / dark zinc-300 for the smaller, dimmer caption-xs,
    // zinc-700 / dark zinc-200 for the slightly lifted caption-md eyebrow
    // class. Pair the @utility with its :where(.dark) override so we catch a
    // partial deletion (e.g. dropping the dark-mode override without removing
    // the base utility).
    const captionXsBlock = css.match(/@utility\s+caption-xs\s*\{([^}]*)\}\s*/);
    const captionMdBlock = css.match(/@utility\s+caption-md\s*\{([^}]*)\}\s*/);
    expect(captionXsBlock, '@utility caption-xs must exist').not.toBeNull();
    expect(captionMdBlock, '@utility caption-md must exist').not.toBeNull();
    expect(/--color-zinc-600/.test(captionXsBlock![1])).toBe(true);
    expect(/--color-zinc-700/.test(captionMdBlock![1])).toBe(true);
    // accept either `.dark .caption-xs { … --color-zinc-300 … }` or the
    // specificity-lowering `:where(.dark) .caption-xs { … }` form (which is
    // what the implementation currently ships).
    expect(/\.dark[)\s]+\.caption-xs\s*\{[^}]*--color-zinc-300/.test(css)).toBe(true);
    expect(/\.dark[)\s]+\.caption-md\s*\{[^}]*--color-zinc-200/.test(css)).toBe(true);
  });
});
