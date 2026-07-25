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
