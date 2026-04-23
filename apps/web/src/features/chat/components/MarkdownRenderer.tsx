"use client";

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import type { PluggableList } from 'unified';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';
import CodeBlock from './CodeBlock';
import MermaidRenderer from './MermaidRenderer';
import { opener } from '../../../lib/ipc';
import { useGlobalSettings } from '../../../store/hooks';

interface MarkdownRendererProps {
  content: string;
}

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function resolveAllowedHref(href: string | undefined | null): string | null {
  if (!href || href.trim() === '') return null;
  try {
    const base =
    typeof window !== 'undefined' && window.location?.href
    ? window.location.href
    : 'https://invalid.invalid/';
    const u = new URL(href, base);
    if (ALLOWED_LINK_PROTOCOLS.has(u.protocol)) {
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return null;
}

const MarkdownRenderer = ({ content }: MarkdownRendererProps) => {
  const globalSettings = useGlobalSettings();
  
  const remarkPlugins: PluggableList = [remarkGfm];
  if (globalSettings.enableLatex) remarkPlugins.push(remarkMath);

  const rehypePlugins: PluggableList = [rehypeHighlight];
  if (globalSettings.enableLatex) rehypePlugins.push(rehypeKatex);

  const handleLinkClick = async (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    const safe = resolveAllowedHref(href);
    if (!safe) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    await opener.openUrl(safe);
  };

  return (
    <ReactMarkdown
    remarkPlugins={remarkPlugins}
    rehypePlugins={rehypePlugins}
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
          a: ({ href, children }) => {
            const safe = resolveAllowedHref(href);
            if (!safe) {
              return (
                <span className="text-zinc-500 cursor-not-allowed font-medium" title="Unsupported link">
                {children}
                </span>
              );
            }
            return (
              <a
              href={safe}
              onClick={(e) => handleLinkClick(e, href || '')}
              className="text-blue-500 hover:underline cursor-pointer font-medium transition-colors"
              target="_blank"
              rel="noopener noreferrer"
              >
              {children}
              </a>
            );
          },
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const lang = match ? match[1] : '';

            if (globalSettings.enableMermaid && lang === 'mermaid') {
              return <MermaidRenderer content={String(children)} />;
            }

            return match ? (
              <CodeBlock
              language={lang}
              value={children}
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