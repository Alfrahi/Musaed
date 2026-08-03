'use client';

import React, { type RefAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared base classes for every text-entry primitive in Musaed.
 *
 * Establishes the canonical border, background, padding, font-size, radius,
 * focus ring, and transition so call-sites need only pass semantic additions
 * (placeholder color, icon padding, sizing) and override defaults via
 * `tailwind-merge` (`cn`) when needed.
 *
 * Per the transition-timing convention (2026-08-03): common inputs use
 * `duration-fast` (150ms) with `transition-all` because border + background +
 * ring animate together on focus.
 */
const inputBaseClasses = [
  'rounded-md',
  'py-2 px-3',
  'text-sm',
  'border border-zinc-200 dark:border-zinc-700',
  'bg-white dark:bg-zinc-900',
  'transition-all duration-150',
  'outline-none',
  'focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
  'placeholder:text-zinc-400 dark:placeholder:text-zinc-500',
].join(' ');

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>, RefAttributes<HTMLInputElement> {}

/**
 * `Input` — the Musaed text-input primitive.
 *
 * Renders a native `<input>` with the shared border / padding / focus-ring
 * baseline. Callers add feature-specific classes (icon padding, larger font,
 * custom placeholder color) via `className`; those overrides win over the
 * defaults via `tailwind-merge` (`cn`).
 *
 * Forwards `ref`, spreads arbitrary `<input>` attributes (`type`, `value`,
 * `onChange`, `aria-label`, `placeholder`, …).
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputBaseClasses, className)} {...props} />
  )
);
Input.displayName = 'Input';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>, RefAttributes<HTMLTextAreaElement> {}

/**
 * `Textarea` — the Musaed multi-line text-input primitive.
 *
 * Renders a native `<textarea>` with the same shared border / padding /
 * focus-ring baseline as `Input`. Callers add feature-specific classes
 * (`resize-none`, `min-h-[100px]`, custom rows) via `className` overrides.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(inputBaseClasses, className)} {...props} />
  )
);
Textarea.displayName = 'Textarea';

export default Input;
