import React from 'react';
import { type Message } from '@musaed/contracts';
import { Cpu, Zap } from 'lucide-react';

interface MessageStatsProps {
  message: Message;
  tps: number;
  formatNumber: (num: number, options?: Intl.NumberFormatOptions) => string;
  tokensLabel: string;
}

export const MessageStats = React.memo(
  ({ message, tps, formatNumber, tokensLabel }: MessageStatsProps) => {
    if (message.role === 'user' || message.eval_count == null) return null;

    return (
      <div className="pbs-4 border-bs border-sidebar-border/50 flex items-center gap-4 text-[9px] font-bold text-zinc-400 uppercase">
        <span className="flex items-center gap-1.5">
          <Cpu size={12} />
          {formatNumber(message.eval_count)}
          {tokensLabel}
        </span>
        {tps > 0 && (
          <span className="text-primary flex items-center gap-1.5">
            <Zap size={12} />
            {formatNumber(tps, { maximumFractionDigits: 1 })} T/S
          </span>
        )}
      </div>
    );
  }
);

MessageStats.displayName = 'MessageStats';
