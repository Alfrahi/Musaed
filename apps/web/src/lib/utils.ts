import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `twMerge` — extended to recognize this repo's Tailwind v4 `@theme` font-size
 * utilities (`text-caption`, `text-body`, `text-label`, `text-heading`).
 *
 * tailwind-merge v3's "native Tailwind v4 support" covers the *default* v4
 * font-size scale (`text-base`, `text-sm`, …) but does NOT auto-detect
 * project-specific `@theme` additions. Our four custom-named utilities fall
 * back through `text-*` to the `text-color` classGroup, so a `text-caption`
 * (font-size) caller class silently evicts a variant's `text-white` (color):
 * invisible button labels — dark-on-dark in light mode, e.g. the sidebar
 * "New Chat" button and any other `Button` whose `size` slot emits one of
 * these utilities (the `md` and `lg` sizes do).
 *
 * Registering them as a distinct `font-size` classGroup keeps color utilities
 * (`text-white`, `text-zinc-900`, `dark:text-zinc-900`, …) intact alongside
 * them. Real color-vs-color conflicts (`bg-blue-600` vs `bg-red-500`) continue
 * to resolve last-wins, preserving the existing override contract.
 *
 * Verified on tailwind-merge@3.6.0: `twMerge('text-white','text-base')` keeps
 * both (native), but `twMerge('text-white','text-caption')` drops `text-white`
 * — so this override remains required on v3.
 */
const twMerge = extendTailwindMerge({
  override: {
    classGroups: {
      'font-size': ['text-caption', 'text-body', 'text-label', 'text-heading'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Extracts filename from a full file path.
 * Shared by conversation and RAG features to avoid duplication.
 */
export function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}
