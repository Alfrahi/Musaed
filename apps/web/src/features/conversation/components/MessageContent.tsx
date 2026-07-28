'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { type Message, findThinkingTags } from '@musaed/contracts';
import ThinkingBlock from './ThinkingBlock';

const MarkdownRenderer = dynamic(() => import('./MarkdownRenderer'), {
  ssr: false,
  loading: () => (
    <div className="animate-pulse space-y-2">
      <div className="h-4 w-3/4 rounded bg-zinc-200 dark:bg-zinc-700" />
      <div className="h-4 w-1/2 rounded bg-zinc-200 dark:bg-zinc-700" />
      <div className="h-4 w-5/6 rounded bg-zinc-200 dark:bg-zinc-700" />
    </div>
  ),
});

interface ParsedContent {
  thinking: string;
  main: string;
  isFinished: boolean;
  shouldCollapse: boolean;
}

const MessageContent = ({ message, isUser }: { message: Message; isUser: boolean }) => {
  const parsed = useMemo((): ParsedContent => {
    const content = message.content || '';
    if (isUser) return { thinking: '', main: content, isFinished: true, shouldCollapse: false };

    const match = findThinkingTags(content);
    if (!match) return { thinking: '', main: content, isFinished: true, shouldCollapse: false };

    const isFinished = match.closeTagLength !== -1;

    const thinking = content.substring(match.contentStart, match.contentEnd).trim();

    const before = content.substring(0, match.tagStart).trim();
    const after = isFinished
      ? content.substring(match.contentEnd + match.closeTagLength).trim()
      : '';

    // Join content outside thinking block, ensuring proper spacing
    const main = [before, after].filter(Boolean).join('\n\n');

    return {
      thinking,
      main,
      isFinished,
      shouldCollapse: isFinished && main.length > 0,
    };
  }, [message.content, isUser]);

  const isStreaming = !isUser && !message.done;
  const showLoading = !isUser && !parsed.main && !parsed.thinking && isStreaming;

  return (
    <div
      className="prose prose-sm md:prose-base dark:prose-invert max-w-none break-words"
      dir="auto"
      aria-busy={isStreaming}
    >
      {!isUser && (parsed.thinking || !parsed.isFinished) && (
        <ThinkingBlock
          content={parsed.thinking}
          isStreaming={!parsed.isFinished}
          isCollapsed={parsed.shouldCollapse}
        />
      )}

      {parsed.main ? (
        <MarkdownRenderer content={parsed.main} />
      ) : showLoading ? (
        <div className="flex gap-1.5 py-2" aria-hidden="true">
          {[0, 150, 300].map((delay) => (
            <div
              key={delay}
              style={{ animationDelay: `${-delay}ms` }}
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500/50"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default MessageContent;
