import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SettingsCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * Presentational card wrapper for settings sections. Provides the border,
 * background, elevation, and padding baseline; each settings component supplies
 * its own icon+label header and body content as children.
 *
 * Spacing convention for settings panels (inside this card):
 * - Top-level section-stack (header → controls, field-group → field-group):
 *   `flex flex-col gap-4` (16px). All settings panels share this rhythm.
 * - Inner field-stack (label-above-input within a single field): `gap-3` (12px).
 * - Between multiple `SettingsCard`s in a tab: `space-y-6` (24px) — set by
 *   `SettingsModal`'s `RenderContent` wrapper, not by individual panels.
 * - Toggle rows: single-row toggle cards use `p-4`; multi-toggle lists (e.g.
 *   MarkdownSettings) use `p-3` per row for tighter list density.
 */
export const SettingsCard = ({ children, className }: SettingsCardProps) => (
  <div
    className={cn(
      'shadow-raised rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/50',
      className
    )}
  >
    {children}
  </div>
);

export default SettingsCard;
