"use client";

import React, { useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import type { PluggableList } from 'unified';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';
import CodeBlock from './CodeBlock';
import { opener } from '../../../lib/ipc';
import { useGlobalSettings } from '../../../store/hooks';

const MermaidRenderer = dynamic(
  () => import('./MermaidRenderer'),
  {
    ssr: false,
    loading: () => (
      <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-zinc-800 animate-pulse">
        <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-1/3 mb-2" />
        <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-2/3" />
      </div>
    ),
  }
);

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

  // Memoize plugins to avoid re-creating them on every render
  const remarkPlugins = useMemo(() => {
    const plugins: PluggableList = [remarkGfm];
    if (globalSettings.enableLatex) plugins.push(remarkMath);
    return plugins;
  }, [globalSettings.enableLatex]);

  const rehypePlugins = useMemo(() => {
    const plugins: PluggableList = [rehypeHighlight];
    if (globalSettings.enableLatex) plugins.push(rehypeKatex);
    return plugins;
  }, [globalSettings.enableLatex]);

  const handleLinkClick = useCallback(async (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    const safe = resolveAllowedHref(href);
    if (!safe) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    await opener.openUrl(safe);
  }, []);

  // Memoize components to ensure stability across renders
  const components = useMemo(() => ({
    p: ({ children }: { children?: React.ReactNode }) => <div className="mbe-4 last:mbe-0 leading-relaxed" dir="auto">{children}</div>,
    pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc ps-6 mbe-4 space-y-1">{children}</ul>,
    ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal ps-6 mbe-4 space-y-1">{children}</ol>,
    li: ({ children }: { children?: React.ReactNode }) => <li className="mbe-1">{children}</li>,
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="border-is-4 border-zinc-200 dark:border-zinc-800 ps-4 italic mbe-4 text-zinc-500">
        {children}
      </blockquote>
    ),
    a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) => {
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
          {...props}
        >
          {children}
        </a>
      );
    },
    code: ({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) => {
      const match = /language-(\w+)/.exec(className || '');
      const lang = match ? match[1] : '';

      console.log('Code block language:', lang, 'Enable Mermaid:', globalSettings.enableMermaid);
      if (globalSettings.enableMermaid && lang === 'mermaid') {
        const content = String(children ?? '');
        console.log('Rendering MermaidRenderer with content:', content);
        return <MermaidRenderer content={content} />;
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
    },
  }), [globalSettings.enableMermaid, handleLinkClick]);

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
};

export default React.memo(MarkdownRenderer);