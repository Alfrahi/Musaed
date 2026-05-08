'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { Copy, Check, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { Message } from '@musaed/contracts';
import { cn } from '../../../lib/utils';
import MessageContent from './MessageContent';
import { attachmentImageSrc } from '../imageAttachment';
import { useMessageActions } from '../hooks/useMessageActions';
import { MessageAvatar } from './MessageAvatar';
import { MessageStats } from './MessageStats';
import { useGlobalSettings } from '../../../store/hooks';
import { useTranslation } from '../../../lib/i18n';

interface MessageBubbleProps {
  message: Message;
  labels: {
    user: string;
    assistant: string;
    copy: string;
    tokens: string;
  };
  formatNumber: (num: number, options?: Intl.NumberFormatOptions) => string;
}

interface SourceReference {
  filePath: string;
  startLine: number;
  endLine: number;
  language?: string;
}

interface RagSourceReferencesProps {
  sources: SourceReference[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
}

/** Renders the RAG source references section. */
const RagSourceReferences = ({
  sources,
  isExpanded,
  onToggleExpand,
  t,
}: RagSourceReferencesProps) => (
  <div className="mt-4 border-t pt-4">
    <button
      className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs font-medium"
      onClick={onToggleExpand}
    >
      <FileText className="h-3 w-3" />
      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      {t('rag.sourceReferenceCount', { count: sources.length })}
    </button>

    {isExpanded && (
      <div className="mt-2 space-y-2 text-xs">
        {sources.map((source, index) => (
          <div key={index} className="bg-secondary/50 flex items-start gap-2 rounded-md p-2">
            <FileText className="text-muted-foreground mt-0.5 h-3 w-3 flex-shrink-0" />
            <div>
              <p className="font-medium">
                {source.filePath}
                <span className="text-muted-foreground ms-1 font-normal">
                  (lines {source.startLine}–{source.endLine})
                </span>
              </p>
              {source.language && (
                <p className="text-muted-foreground">Language: {source.language}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

/**
 * Renders a single message bubble in the chat window.
 */
const MessageBubble = ({ message, labels, formatNumber }: MessageBubbleProps) => {
  const isUser = message.role === 'user';
  const { copied, handleCopy, tps } = useMessageActions(message);
  const sourceReferences = (message.ragSources ?? []) as SourceReference[];
  const [isExpanded, setIsExpanded] = useState(false);

  const globalSettings = useGlobalSettings();
  const { t } = useTranslation(globalSettings.language);

  return (
    <div
      className={cn(
        'border-be border-sidebar-border w-full transition-colors',
        isUser ? 'bg-background' : 'bg-zinc-50 dark:bg-zinc-900/30'
      )}
    >
      <div className="ms-auto me-auto flex max-w-4xl gap-6 py-8 ps-6 pe-6">
        <MessageAvatar isUser={isUser} />

        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400 uppercase">
              {isUser ? labels.user : labels.assistant}
              {!isUser && message.model && (
                <span className="ms-3 text-zinc-500">{message.model}</span>
              )}
            </span>
            <button
              onClick={handleCopy}
              className="hover:text-foreground p-1 text-zinc-400 transition-colors"
              aria-label={labels.copy}
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
                  className="border-sidebar-border max-w-sm border shadow-sm"
                />
              ))}
            </div>
          )}

          <div className="text-foreground selection:bg-primary/20 text-[14px] leading-relaxed antialiased">
            <MessageContent message={message} isUser={isUser} />
          </div>

          {/* RAG Source References */}
          {sourceReferences.length > 0 && (
            <RagSourceReferences
              sources={sourceReferences}
              isExpanded={isExpanded}
              onToggleExpand={() => setIsExpanded(!isExpanded)}
              t={t}
            />
          )}

          <MessageStats
            message={message}
            tps={tps}
            formatNumber={formatNumber}
            tokensLabel={labels.tokens}
          />
        </div>
      </div>
    </div>
  );
};

export default React.memo(MessageBubble);
