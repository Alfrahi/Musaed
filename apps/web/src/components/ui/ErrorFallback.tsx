'use client';

import { AlertCircle, RefreshCw, WifiOff, Server, FileX, Ban } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore } from '@/store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export type FallbackType = 'general' | 'network' | 'ollama' | 'notFound' | 'forbidden';

interface ErrorFallbackProps {
  type?: FallbackType;
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}

const getIconAndDefaults = (
  type: FallbackType,
  t: (key: string) => string
): {
  icon: typeof AlertCircle;
  defaultTitle: string;
  defaultDescription: string;
} => {
  switch (type) {
    case 'network':
      return {
        icon: WifiOff,
        defaultTitle: t('fallback.network.title'),
        defaultDescription: t('fallback.network.description'),
      };
    case 'ollama':
      return {
        icon: Server,
        defaultTitle: t('fallback.ollama.title'),
        defaultDescription: t('fallback.ollama.description'),
      };
    case 'notFound':
      return {
        icon: FileX,
        defaultTitle: t('fallback.notFound.title'),
        defaultDescription: t('fallback.notFound.description'),
      };
    case 'forbidden':
      return {
        icon: Ban,
        defaultTitle: t('fallback.forbidden.title'),
        defaultDescription: t('fallback.forbidden.description'),
      };
    default:
      return {
        icon: AlertCircle,
        defaultTitle: t('fallback.general.title'),
        defaultDescription: t('fallback.general.description'),
      };
  }
};

export const ErrorFallback = ({
  type = 'general',
  title,
  description,
  onRetry,
  className,
  compact = false,
}: ErrorFallbackProps) => {
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const { icon: Icon, defaultTitle, defaultDescription } = getIconAndDefaults(type, t);
  const displayDescription = description || defaultDescription;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center',
        compact ? 'gap-2 p-4' : 'gap-4 p-6',
        className
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20',
          compact ? 'h-10 w-10' : 'h-14 w-14'
        )}
      >
        <Icon size={compact ? 20 : 24} className="text-red-600 dark:text-red-400" />
      </div>

      <div className="text-center">
        <h3
          className={cn(
            'font-semibold text-zinc-900 dark:text-zinc-100',
            compact ? 'text-body' : 'text-heading'
          )}
        >
          {title || defaultTitle}
        </h3>
        {displayDescription && (
          <p
            className={cn(
              'mbs-1 text-zinc-600 dark:text-zinc-400',
              compact ? 'text-caption' : 'text-body'
            )}
          >
            {displayDescription}
          </p>
        )}
      </div>

      {onRetry && (
        <Button variant="secondary" size={compact ? 'sm' : 'md'} onClick={onRetry}>
          <RefreshCw size={14} />
          {t('fallback.retry')}
        </Button>
      )}
    </div>
  );
};

export const InlineError = ({
  message,
  onDismiss,
  className,
}: {
  message: string;
  onDismiss?: () => void;
  className?: string;
}) => {
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);

  return (
    <div
      className={cn(
        'text-body flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300',
        className
      )}
    >
      <AlertCircle size={16} className="shrink-0" />
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          className="shrink-0 text-red-500 hover:text-red-700 dark:hover:text-red-300"
          aria-label={t('common.close')}
        >
          <span className="text-lg leading-none">&times;</span>
        </Button>
      )}
    </div>
  );
};

export default ErrorFallback;
