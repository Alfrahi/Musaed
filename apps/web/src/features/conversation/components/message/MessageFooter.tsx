'use client';

import { Check, Copy, Cpu, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Message } from '@musaed/contracts';
import type { TranslateFn } from './types';
import { HoverActions } from './HoverActions';

export interface MessageFooterProps {
  isUser: boolean;
  isStopped: boolean;
  msgId: string;
  labels: {
    copy: string;
    tokens: string;
    outputTokens: string;
  };
  message: Message;
  tps: number;
  formatNumber: (num: number, options?: Intl.NumberFormatOptions) => string;
  copied: boolean;
  handleCopy: (overrideText?: string) => void;
  onRegenerate?: (msgId: string) => void;
  onContinue?: (msgId: string) => void;
  onStartEdit?: () => void;
  handleDelete?: (() => void) | undefined;
  t: TranslateFn;
}

export const MessageFooter = ({
  isUser,
  isStopped,
  msgId,
  labels,
  message,
  tps,
  formatNumber,
  copied,
  handleCopy,
  onRegenerate,
  onContinue,
  onStartEdit,
  handleDelete,
  t,
}: MessageFooterProps) => {
  const evalCount = message.evalCount;
  const hasStats = !isUser && evalCount != null;

  return (
    <div className="pbs-4 border-bs border-sidebar-border/50 flex items-center gap-4">
      {hasStats && evalCount != null && (
        <div className="caption-xs flex items-center gap-4 font-bold text-zinc-400">
          {/* Only per-message stats here: `evalCount` is this reply's output.
              `promptEvalCount` is cumulative (whole context re-tokenized each
              turn), so it belongs solely in the TokenContextBar. */}
          <span className="flex items-center gap-1.5">
            <Cpu size={12} />
            {formatNumber(evalCount)}
            {labels.outputTokens}
          </span>
          {tps > 0 && (
            <span className="text-primary flex items-center gap-1.5">
              <Zap size={12} />
              {formatNumber(tps, { maximumFractionDigits: 1 })} T/S
            </span>
          )}
        </div>
      )}

      <div className="ms-auto flex items-center gap-1">
        <HoverActions
          isUser={isUser}
          isStopped={isStopped}
          msgId={msgId}
          onRegenerate={onRegenerate}
          onContinue={onContinue}
          onStartEdit={onStartEdit}
          t={t}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => handleCopy()}
          className="hover:text-foreground cursor-pointer p-1 text-zinc-400"
          aria-label={labels.copy}
        >
          {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
        </Button>
        {handleDelete && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            className="hover:text-foreground cursor-pointer p-1 text-zinc-400"
            aria-label={t('common.delete')}
            title={t('common.delete')}
          >
            <Trash2 size={14} />
          </Button>
        )}
      </div>
    </div>
  );
};
