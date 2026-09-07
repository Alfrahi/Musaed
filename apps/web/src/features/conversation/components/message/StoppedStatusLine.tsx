'use client';

import { Button } from '@/components/ui/button';
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
        <Button
          variant="ghost"
          onClick={() => onContinue(msgId)}
          className="text-primary text-caption hover:text-primary h-auto p-0 font-medium hover:bg-transparent hover:underline"
        >
          {t('chat.continue')}
        </Button>
      )}
    </div>
  );
};
