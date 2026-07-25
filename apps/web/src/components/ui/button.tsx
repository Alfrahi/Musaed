'use client';

import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * `buttonVariants` is the canonical CVA recipe for the Musaed `Button`.
 *
 * Tokens are sourced exclusively from `@theme` (globals.css) — no new color
 * tokens are invented. The numeric typesize / tracking / radius choices mirror
 * the existing ad-hoc button styles across the chat compose surface and modal
 * footers so the migration is visually neutral. See: ImplementationPromptSequence
 * Prompt 4.
 *
 * `size: 'icon'` is reserved for square icon-only buttons (e.g. modal close,
 * refresh) — it collapses the padding and centres an icon.
 */
export const buttonVariants = cva(
  // base — applies to every variant
  [
    'inline-flex items-center justify-center gap-2 rounded-lg font-bold',
    'uppercase tracking-widest transition-all',
    'active:scale-95',
    'outline-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:opacity-20 disabled:pointer-events-none',
  ].join(' '),
  {
    variants: {
      variant: {
        // Solid primary action — used for Send, modal footer confirm.
        primary: 'bg-blue-600 text-white shadow-sm hover:opacity-90 dark:bg-blue-500',
        // High-contrast "utility" solid — used on the Abort button and the
        // modal Done footer. Preserves the existing dark-on-light / light-on-dark
        // contrast pair these surfaces already had.
        secondary:
          'bg-zinc-900 text-white shadow-sm hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900',
        // Transparent — used for tab navigation, modal close, refresh, attach.
        ghost:
          'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
        // Bordered — used for reset / destructive-but-not-primary buttons.
        outline:
          'border border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800',
        // Destructive — used for project delete, reset preferences, abort.
        danger:
          'bg-red-500 text-white shadow-sm hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500',
      },
      size: {
        sm: 'h-8 px-3 text-[10px]',
        md: 'h-10 px-4 text-[10px]',
        lg: 'h-12 px-6 text-xs',
        icon: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

/**
 * `Button` — the Musaed button primitive.
 *
 * Defaults to `type="button"` (NOT `submit`) unless overridden — this is the
 * safe default for app-style surfaces and prevents accidental form submission
 * when used inside modal/tab navigation. Callers that need submit semantics
 * pass `type="submit"` explicitly (e.g. the chat compose form's send button).
 *
 * Forwards `ref`, merges `className` after `buttonVariants` so caller classes
 * win over CVA defaults via `tailwind-merge` (see `cn`).
 *
 * `asChild` is intentionally NOT supported — Radix `Slot` is not a dependency
 * (STANDARDS §21 — do not invent dependencies). Compose with `<a>` or other
 * elements directly if you need a non-button surface styled like a button;
 * use `buttonVariants({ ... })` to apply the same classes.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = 'Button';

export default Button;
