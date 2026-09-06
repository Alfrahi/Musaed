'use client';

import type { TranslateFn } from './types';

interface StoppedStatusLineProps {
  isStopped: boolean;
  msgId: string;
  onContinue?: (msgId: string) => void;
  t: TranslateFn;
}

export const StoppedStatusLine = ({ isStopped, msgId, onContinue, t }: StoppedStatusLineProps) => {
  if (!isStopped) return null;
  return (
    <div className="text-caption flex items-center gap-2 text-zinc-500">
      <span>{t('chat.stoppedByUser')}</span>
      <span>•</span>
      {onContinue && (
        <button
          type="button"
          onClick={() => onContinue(msgId)}
          className="text-primary cursor-pointer font-medium hover:underline"
        >
          {t('chat.continue')}
        </button>
      )}
    </div>
  );
};
