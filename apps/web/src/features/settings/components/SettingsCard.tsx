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
