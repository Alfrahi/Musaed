'use client';

import type { IndexProgress } from '@musaed/contracts';
import { useGlobalSettings } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { useActiveRagProject } from '@/store/rag-store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface IndexingProgressProps {
  progress: IndexProgress;
  onAbort: () => void;
  onRetry?: () => void;
}

export const IndexingProgress = ({ progress, onAbort, onRetry }: IndexingProgressProps) => {
  const percentage = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const globalSettings = useGlobalSettings();
  const { t } = useTranslation(globalSettings.language);
  const activeProject = useActiveRagProject();

  const label = t(`rag.indexPhase.${progress.phase}`, { defaultValue: progress.phase });
  const isFailed = progress.phase === 'failed';
  const isCompleted = progress.phase === 'completed';
  const isRetrying =
    progress.phase === 'discoveringFiles' && progress.current > 0 && progress.total === 3;
  const retryAttempt = activeProject?.retryAttempts ?? 0;
  const maxRetries = 3; // Matches backend constant
  const showRetryButton = isFailed && retryAttempt < maxRetries;

  // Check if this is a retry attempt (backend sends current=1,2,3 and total=3 for retries)
  const retryLabel = isRetrying
    ? t('rag.retryMessages.retryAttempt', { attempt: progress.current, max: maxRetries })
    : label;

  return (
    <div className="mt-1 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          {retryLabel}
          {progress.total > 0 && !isRetrying && ` (${progress.current}/${progress.total})`}
        </span>
        <div className="flex items-center gap-2">
          {showRetryButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onRetry?.();
              }}
              className="text-xs text-blue-400 hover:bg-blue-400/10 hover:text-blue-300"
            >
              {t('rag.retry')}
            </Button>
          )}
          {!isCompleted && !isFailed && !showRetryButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onAbort();
              }}
              className="text-xs text-red-400 hover:bg-red-400/10 hover:text-red-300"
            >
              {t('rag.cancel')}
            </Button>
          )}
        </div>
      </div>

      <div className="bg-secondary h-1.5 w-full overflow-hidden rounded-full">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300',
            isFailed ? 'bg-red-500' : isCompleted ? 'bg-green-500' : 'bg-primary'
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {progress.message && (
        <p className="text-muted-foreground truncate text-xs">{progress.message}</p>
      )}

      {isFailed && activeProject?.lastError && retryAttempt >= maxRetries && (
        <p className="truncate text-xs text-red-400">
          {t('rag.retryMessages.maxRetriesReached', { error: activeProject.lastError })}
        </p>
      )}

      {isFailed && activeProject?.lastError && retryAttempt < maxRetries && (
        <p className="truncate text-xs text-red-400">
          {t('rag.retryMessages.lastError', { error: activeProject.lastError })}
        </p>
      )}
    </div>
  );
};
