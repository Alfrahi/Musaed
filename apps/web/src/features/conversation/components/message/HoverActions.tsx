'use client';

import { Play, Pencil, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TranslateFn } from './types';

interface HoverActionsProps {
  isUser: boolean;
  isStopped: boolean;
  msgId: string;
  onRegenerate?: (msgId: string) => void;
  onContinue?: (msgId: string) => void;
  onStartEdit?: () => void;
  t: TranslateFn;
}

export const HoverActions = ({
  isUser,
  isStopped,
  msgId,
  onRegenerate,
  onContinue,
  onStartEdit,
  t,
}: HoverActionsProps) => {
  const hasActions = (isUser && onStartEdit) || (!isUser && (onRegenerate || onContinue));
  if (!hasActions) return null;

  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
      {!isUser && onRegenerate && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onRegenerate(msgId)}
          aria-label={t('chat.regenerate')}
          title={t('chat.regenerate')}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      )}
      {!isUser && isStopped && onContinue && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onContinue(msgId)}
          aria-label={t('chat.continue')}
          title={t('chat.continue')}
        >
          <Play className="h-3.5 w-3.5" />
        </Button>
      )}
      {isUser && onStartEdit && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onStartEdit}
          aria-label={t('chat.editPrompt')}
          title={t('chat.editPrompt')}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
};
