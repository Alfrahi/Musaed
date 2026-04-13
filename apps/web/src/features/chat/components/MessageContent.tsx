"use client";

import { useMemo } from 'react';
import { Message } from '@musaed/contracts';
import ThinkingBlock from './ThinkingBlock';
import MarkdownRenderer from './MarkdownRenderer';

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

    const TAG_START = '<think>';
    const TAG_END = '</think>';
    
    const thinkStart = content.indexOf(TAG_START);
    if (thinkStart === -1) return { thinking: '', main: content, isFinished: true, shouldCollapse: false };

    const thinkEnd = content.indexOf(TAG_END);
    const isFinished = thinkEnd !== -1;
    
    const thinking = content.substring(
      thinkStart + TAG_START.length, 
      isFinished ? thinkEnd : content.length
    ).trim();

    const before = content.substring(0, thinkStart).trim();
    const after = isFinished ? content.substring(thinkEnd + TAG_END.length).trim() : '';
    
    // Join content outside thinking block, ensuring proper spacing
    const main = [before, after].filter(Boolean).join('\n\n');
    
    return {
      thinking,
      main,
      isFinished,
      shouldCollapse: isFinished && main.length > 0
    };
  }, [message.content, isUser]);

  const isStreaming = !isUser && !message.done;
  const showLoading = !isUser && !parsed.main && !parsed.thinking && isStreaming;

  return (
    <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none break-words" dir="auto">
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
          {[0, 150, 300].map(delay => (
            <div 
              key={delay}
              style={{ animationDelay: `${-delay}ms` }}
              className="w-1.5 h-1.5 bg-blue-500/50 rounded-full animate-bounce" 
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default MessageContent;