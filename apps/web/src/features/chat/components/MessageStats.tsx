import React from 'react';
import { Message } from '@musaed/contracts';
import { Cpu, Zap } from 'lucide-react';
import { TranslationKey } from '../../../lib/i18n';

interface MessageStatsProps {
  message: Message;
  tps: number;
  formatNumber: (num: number, options?: Intl.NumberFormatOptions) => string;
  t: (key: TranslationKey | string, values?: Record<string, string | number | boolean>) => string;
}

export const MessageStats = React.memo(({ message, tps, formatNumber, t }: MessageStatsProps) => {
  if (message.role === 'user' || message.eval_count === undefined) return null;

  return (
    <div className="flex items-center gap-4 text-[9px] font-bold uppercase text-zinc-400 pbs-4 border-bs border-sidebar-border/50">
      <span className="flex items-center gap-1.5">
        <Cpu size={12} /> {formatNumber(message.eval_count)} {t('chat.tokens')}
      </span>
      {tps > 0 && (
        <span className="flex items-center gap-1.5 text-primary">
          <Zap size={12} /> {formatNumber(tps, { maximumFractionDigits: 1 })} T/S
        </span>
      )}
    </div>
  );
});

MessageStats.displayName = 'MessageStats';
