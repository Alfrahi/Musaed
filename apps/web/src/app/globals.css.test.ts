import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS_PATH = resolve(__dirname, 'globals.css');

function loadCss(): string {
  return readFileSync(CSS_PATH, 'utf8');
}

describe('globals.css :focus-visible affordance (STANDARDS.md §13)', () => {
  const css = loadCss();

  it('declares a :focus-visible rule with a non-`none` outline', () => {
    // Locate the `:focus-visible { ... }` block (single-rule scope, no nested
    // braces expected). Fail loudly if the rule itself is missing — that would
    // mean the global focus affordance was dropped.
    const blockMatch = css.match(/:focus-visible\s*\{([^}]*)\}/);
    expect(blockMatch, ':focus-visible rule must exist in globals.css').not.toBeNull();
    const block = blockMatch![1];

    // Must NOT contain `outline: none` (case-insensitive, with optional whitespace).
    expect(/outline\s*:\s*none/i.test(block)).toBe(false);

    // Must declare an outline with a visible style — `outline: 2px solid <color>`
    // is the canonical form per the implementation prompt.
    const outlineMatch = block.match(/outline\s*:\s*(.+?);/);
    expect(outlineMatch, ':focus-visible must declare an `outline:` property').not.toBeNull();
    const outlineValue = outlineMatch![1].trim();
    expect(outlineValue).not.toBe('none');
    // Sanity: the canonical recipe writes a width + style + color triple.
    expect(/^\d/.test(outlineValue), 'outline must start with a numeric width').toBe(true);
  });

  it('does not regress with a global `outline: none` outside :focus-visible', () => {
    // Strip the focus-visible block so we only inspect the rest of the file —
    // any remaining `outline: none` would be a regression.
    const withoutFocusVisible = css.replace(/:focus-visible\s*\{[^}]*\}\s*/, '');
    expect(/outline\s*:\s*none/i.test(withoutFocusVisible)).toBe(false);
  });
});

describe('globals.css typography utilities (audit §F9 / STANDARDS.md §13 — WCAG 1.4.3)', () => {
  const css = loadCss();

  it('does not declare a global `letter-spacing: 0 !important` (audit §F9 + §D7)', () => {
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
