'use client';

import React, { useId } from 'react';
import { cn } from '@/lib/utils';

export interface ToggleProps {
  /** Whether the switch is in the "on" position. */
  checked: boolean;
  /** Called with the next (inverted) value when the switch is activated. */
  onChange: (checked: boolean) => void;
  /**
   * Text that labels the switch. Rendered visibly and referenced by
   * `aria-labelledby` so screen readers announce the switch by its name.
   */
  label: string;
  /** Optional description rendered below the label. When provided, it is
   * linked to the switch via `aria-describedby`. */
  description?: string;
  /** Disable the switch (non-interactive, dimmed). */
  disabled?: boolean;
  /** Override or extend the wrapper classes. */
  className?: string;
}

/**
 * `Toggle` — the Musaed switch primitive.
 *
 * Renders a `<button role="switch">` with a sliding thumb, paired with a
 * visible label and optional description. The label element is stamped with
 * a generated id and wired to the switch via `aria-labelledby`, so screen
 * readers announce the label as the switch's accessible name — closing the
 * gap left by the old plain `<label>` patterns that had no `htmlFor`/`id`
 * association.
 *
 * Track / thumb sizes (`h-6 w-10` / `h-4 w-4`) and the `ltr:translate-x-4
 * rtl:-translate-x-4` on/off translation are the canonical dimensions shared
 * across all settings toggles — extracting them here means a visual fix lands
 * once instead of across N call-sites.
 *
 * Uses a raw `<button>` (not the `Button` CVA primitive) because
 * `role="switch"` is a distinct ARIA affordance, not an action button — the
 * same eslint exemption the other non-button UI primitives carry.
 */
const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(
  ({ checked, onChange, label, description, disabled, className }, ref) => {
    const labelId = useId();
    const descId = useId();

    return (
      <div className={cn('flex items-start gap-4', className)}>
        <div className="min-w-0 flex-1">
          <p id={labelId} className="text-caption font-medium text-zinc-900 dark:text-zinc-100">
            {label}
          </p>
          {description && (
            <p id={descId} className="caption-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {description}
            </p>
          )}
        </div>
        {/* eslint-disable-next-line musaed-buttons/prefer-button-primitive -- role="switch" toggle, not a CVA action button */}
        <button
          ref={ref}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={labelId}
          aria-describedby={description ? descId : undefined}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={cn(
            'focus-ring duration-normal h-6 w-10 shrink-0 rounded-full p-1 transition-colors ease-in-out',
            checked ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600',
            disabled && 'opacity-40'
          )}
        >
          <div
            className={cn(
              'shadow-native duration-normal h-4 w-4 transform rounded-full bg-white transition-transform ease-in-out',
              checked ? 'ltr:translate-x-4 rtl:-translate-x-4' : 'translate-x-0'
            )}
          />
        </button>
      </div>
    );
  }
);
Toggle.displayName = 'Toggle';

export { Toggle };
export default Toggle;
