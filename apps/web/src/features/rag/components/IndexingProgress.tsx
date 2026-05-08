'use client';

import type { IndexProgress } from '@musaed/contracts';
import { useGlobalSettings } from '../../../store/hooks';
import { useTranslation } from '../../../lib/i18n';

interface IndexingProgressProps {
  progress: IndexProgress;
  onAbort: () => void;
}

export const IndexingProgress = ({ progress, onAbort }: IndexingProgressProps) => {
  const percentage = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const globalSettings = useGlobalSettings();
  const { t } = useTranslation(globalSettings.language);

  const label = t(`rag.indexPhase.${progress.phase}`, { defaultValue: progress.phase });
  const isFailed = progress.phase === 'failed';
  const isCompleted = progress.phase === 'completed';

  return (
    <div className="mt-1 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          {label}
          {progress.total > 0 && ` (${progress.current}/${progress.total})`}
        </span>
        {!isCompleted && !isFailed && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAbort();
            }}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Cancel
          </button>
        )}
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
    </div>
  );
};

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
