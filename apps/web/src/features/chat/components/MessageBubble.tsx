"use client";

import React from 'react';
import Image from 'next/image';
import { Copy, Check } from 'lucide-react';
import { Message } from '@musaed/contracts';
import { cn } from '../../../lib/utils';
import MessageContent from './MessageContent';
import { useLanguage } from '../../../store/hooks';
import { useTranslation } from '../../../lib/i18n';
import { attachmentImageSrc } from '../imageAttachment';
import { useMessageActions } from '../hooks/useMessageActions';
import { MessageAvatar } from './MessageAvatar';
import { MessageStats } from './MessageStats';

interface MessageBubbleProps {
  message: Message;
}

/**
 * Renders a single message bubble in the chat window.
 */
const MessageBubble = ({ message }: MessageBubbleProps) => {
  const isUser = message.role === 'user';
  const language = useLanguage();
  const { t, formatNumber } = useTranslation(language);
  const { copied, handleCopy, tps } = useMessageActions(message);

  return (
    <div className={cn(
      "w-full border-be border-sidebar-border transition-colors",
      isUser ? "bg-background" : "bg-zinc-50 dark:bg-zinc-900/30"
    )}>
      <div className="max-w-4xl ms-auto me-auto ps-6 pe-6 py-8 flex gap-6">
        <MessageAvatar isUser={isUser} />

        <div className="flex-1 min-w-0 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase text-zinc-400">
              {isUser ? t('chat.user') : t('chat.assistant')}
              {!isUser && message.model && <span className="ms-3 text-zinc-500">{message.model}</span>}
            </span>
            <button 
              onClick={handleCopy} 
              className="text-zinc-400 hover:text-foreground p-1 transition-colors"
              aria-label={t('common.copy')}
            >
              {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
            </button>
          </div>

          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {message.images.map((img, idx) => (
                <Image
                  key={idx}
                  src={attachmentImageSrc(img)}
                  alt=""
                  width={384}
                  height={256}
                  unoptimized
                  className="max-w-sm border border-sidebar-border shadow-sm"
                />
              ))}
            </div>
          )}

          <div className="text-[14px] leading-relaxed text-foreground antialiased selection:bg-primary/20">
            <MessageContent message={message} isUser={isUser} />
          </div>

          <MessageStats message={message} tps={tps} formatNumber={formatNumber} t={t} />
        </div>
      </div>
    </div>
  );
};


export default React.memo(MessageBubble);