"use client";

import React, { useState } from 'react';
import { User, Bot, Copy, Check, Zap, Cpu } from 'lucide-react';
import { Message } from '@musaed/contracts';
import { cn } from '../../../lib/utils';
import MessageContent from './MessageContent';
import { useSettingsStore } from '../../../store';
import { useTranslation } from '../../../lib/i18n';
import { attachmentImageSrc } from '../imageAttachment';

interface MessageBubbleProps {
  message: Message;
}

const MessageBubble = ({ message }: MessageBubbleProps) => {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const { globalSettings } = useSettingsStore();
  const { t, formatNumber } = useTranslation(globalSettings.language);

  const handleCopy = () => {
    const cleanContent = message.content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    navigator.clipboard.writeText(cleanContent || message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const durationNs = message.eval_duration || message.total_duration || 0;
  const tps = message.eval_count !== undefined && durationNs > 0 ? (message.eval_count / (durationNs / 1e9)) : 0;

  return (
    <div className={cn(
      "w-full border-b border-sidebar-border transition-colors",
      isUser ? "bg-background" : "bg-zinc-50 dark:bg-zinc-900/30"
    )}>
      <div className="max-w-4xl mx-auto px-6 py-8 flex gap-6">
        <div className={cn(
          "w-8 h-8 shrink-0 flex items-center justify-center border",
          isUser ? "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500" : "bg-primary border-primary text-white"
        )}>
          {isUser ? <User size={16} /> : <Bot size={16} />}
        </div>

        <div className="flex-1 min-w-0 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
              {isUser ? t('chat.user') : t('chat.assistant')}
              {!isUser && message.model && <span className="ms-3 text-zinc-500">{message.model}</span>}
            </span>
            <button onClick={handleCopy} className="text-zinc-400 hover:text-foreground p-1 transition-colors">
              {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
            </button>
          </div>

          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {message.images.map((img, idx) => (
                <img key={idx} src={attachmentImageSrc(img)} alt="" className="max-w-sm border border-sidebar-border shadow-sm" />
              ))}
            </div>
          )}

          <div className="text-[14px] leading-relaxed text-foreground antialiased selection:bg-primary/20">
            <MessageContent message={message} isUser={isUser} />
          </div>

          {!isUser && message.eval_count !== undefined && (
            <div className="flex items-center gap-4 text-[9px] font-bold uppercase tracking-widest text-zinc-400 pt-4 border-t border-sidebar-border/50">
              <span className="flex items-center gap-1.5"><Cpu size={12} /> {formatNumber(message.eval_count)} {t('chat.tokens')}</span>
              {tps > 0 && <span className="flex items-center gap-1.5 text-primary"><Zap size={12} /> {formatNumber(tps, { maximumFractionDigits: 1 })} T/S</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(MessageBubble);