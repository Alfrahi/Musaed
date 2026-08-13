import React from 'react';
import { type Message } from '@musaed/contracts';
import { Cpu, Zap } from 'lucide-react';

interface MessageStatsProps {
  message: Message;
  tps: number;
  formatNumber: (num: number, options?: Intl.NumberFormatOptions) => string;
  outputTokensLabel: string;
  promptTokensLabel: string;
  totalTokensLabel: string;
}

export const MessageStats = React.memo(
  ({
    message,
    tps,
    formatNumber,
    outputTokensLabel,
    promptTokensLabel,
    totalTokensLabel,
  }: MessageStatsProps) => {
    if (message.role === 'user' || message.evalCount == null) return null;

    const promptTokens = message.promptTokens ?? message.promptEvalCount ?? null;
    const completionTokens = message.completionTokens ?? message.evalCount ?? null;

    return (
      <div className="pbs-4 border-bs border-sidebar-border/50 caption-xs flex items-center gap-4 font-bold text-zinc-400">
        {promptTokens != null && (
          <span className="flex items-center gap-1.5">
            <Cpu size={12} />
            {formatNumber(promptTokens)}
            {promptTokensLabel}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <Cpu size={12} />
          {formatNumber(message.evalCount)}
          {outputTokensLabel}
        </span>
        {promptTokens != null && completionTokens != null && (
          <span className="flex items-center gap-1.5">
            <Cpu size={12} />
            {formatNumber(promptTokens + completionTokens)}
            {totalTokensLabel}
          </span>
        )}
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
