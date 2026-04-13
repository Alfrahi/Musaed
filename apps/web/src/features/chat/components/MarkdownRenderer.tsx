"use client";

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import CodeBlock from './CodeBlock';
import { opener } from '../../../lib/ipc';

interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer = ({ content }: MarkdownRendererProps) => {
  const handleLinkClick = async (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (href.startsWith('http')) {
      e.preventDefault();
      await opener.openUrl(href);
    }
  };

  return (
    <ReactMarkdown 
      remarkPlugins={[remarkGfm]} 
      rehypePlugins={[rehypeHighlight]}
      components={{
        p: ({ children }) => <div className="mbe-4 last:mbe-0 leading-relaxed" dir="auto">{children}</div>,
        pre: ({ children }) => <>{children}</>,
        ul: ({ children }) => <ul className="list-disc ps-6 mbe-4 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal ps-6 mbe-4 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="mbe-1">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="border-is-4 border-zinc-200 dark:border-zinc-800 ps-4 italic mbe-4 text-zinc-500">
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => (
          <a 
            href={href} 
            onClick={(e) => handleLinkClick(e, href || '')}
            className="text-blue-500 hover:underline cursor-pointer font-medium transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          return match ? (
            <CodeBlock
              language={match[1]}
              value={String(children).replace(/\n$/, '')}
            />
          ) : (
            <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-sm font-mono text-blue-600 dark:text-blue-400" {...props}>
              {children}
            </code>
          );
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

export default MarkdownRenderer;