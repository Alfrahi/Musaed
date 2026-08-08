/**
 * Design tokens — single source of truth for the Musaed UI.
 *
 * Each value here MUST mirror the corresponding variable in the `@theme` block
 * of `apps/web/src/app/globals.css`. Tailwind v4 reads the CSS `@theme`
 * directive (not this file) for utility-class generation; this module exists
 * so TS/JS code (inline styles, animation logic, IPC-driven sizing) can
 * reference the same scale without drifting from the CSS.
 *
 * When you change a value here, change the matching `@theme` entry in
 * globals.css in the same commit. The two are intentionally kept in lockstep.
 */

export const RADIUS = {
  sm: '2px',
  md: '4px',
  lg: '6px',
} as const;

export const SPACING = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  6: '24px',
  8: '32px',
} as const;

export const FONT_SIZE = {
  caption: '12px',
  body: '14px',
  label: '13px',
  heading: '16px',
} as const;

// SHADOW was removed. The CSS @theme block in globals.css is
// the single source of truth for shadow tokens (`--shadow-native`,
// `--shadow-raised`, `--shadow-pro`); no JS consumer of a SHADOW constant
// exists in the codebase.

export const TRANSITION = {
  fast: '150ms',
  normal: '200ms',
  slow: '300ms',
} as const;
