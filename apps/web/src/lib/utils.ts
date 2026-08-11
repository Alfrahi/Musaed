import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `twMerge` — extended to know about this repo's Tailwind v4 `@theme` font-size
 * utilities (`text-caption`, `text-body`, `text-label`, `text-heading`). The
 * upstream `tailwind-merge@2` classGroups (built against the Tailwind v3 default
 * palette) classify every `text-*` utility as the same "text-color" slot, so a
 * `text-caption` (font-size) caller class silently evicts a variant's `text-white`
 * (color) class. Result: invisible button labels — dark-on-dark in light mode,
 * e.g. the sidebar "New Chat" button and any other `Button` whose `size` slot
 * emits a `text-caption` / `text-body` utility (the `md` and `lg` sizes do).
 *
 * Registering these four as a distinct `font-size` classGroup keeps color
 * utilities (`text-white`, `text-zinc-900`, `dark:text-zinc-900`, …) intact
 * alongside them. Real color-vs-color conflicts (`bg-blue-600` vs `bg-red-500`)
 * continue to resolve last-wins, preserving the existing override contract.
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
