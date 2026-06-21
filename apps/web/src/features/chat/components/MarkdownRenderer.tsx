'use client';

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
import { useSettingsStore } from '../../settings/store/settings-store';
import { useTranslation } from '../../../lib/i18n';

const MermaidRenderer = dynamic(() => import('./MermaidRenderer'), {
  ssr: false,
  loading: () => (
    <div className="animate-pulse rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="mb-2 h-4 w-1/3 rounded bg-zinc-200 dark:bg-zinc-700" />
      <div className="h-4 w-2/3 rounded bg-zinc-200 dark:bg-zinc-700" />
    </div>
  ),
});

interface MarkdownRendererProps {
  /** Markdown content to render (may contain LaTeX) */
  content: string;
}

/**
 * Normalizes LaTeX delimiters from various LLM outputs into standard $...$ and $$...$$ format.
 */
const normalizeLatexDelimiters = (content: string): string => {
  if (!content?.trim()) return content;

  let transformed = content;

  transformed = transformed.replace(
    /\\{1,2}\[\s*([\s\S]*?)\s*\\{1,2}\]/g,
    (_, inner) => `\n$$\n${inner.trim()}\n$$\n`
  );

  transformed = transformed.replace(
    /\\{1,2}\(\s*([\s\S]*?)\s*\\{1,2}\)/g,
    (_, inner) => `$${inner.trim()}$`
  );

  transformed = transformed.replace(
    /(?<![\w$\\])\(\s*([^)]*?[\^_={}+\-*/\\][^)]*?)\s*\)(?![\w$\\])/g,
    (_, inner) => `$${inner.trim()}$`
  );

  transformed = transformed.replace(
    /^\s*\[\s*([\s\S]*?)\s*\]\s*$/gm,
    (_, inner) => `\n$$\n${inner.trim()}\n$$\n`
  );

  transformed = transformed.replace(/\\left\s*\[/g, '\\left[');
  transformed = transformed.replace(/\\right\s*\]/g, '\\right]');
  transformed = transformed.replace(/\\left\s*\{/g, '\\left\\{');
  transformed = transformed.replace(/\\right\s*\}/g, '\\right\\}');

  return transformed;
};

/** Sanitizes hrefs to only allow safe protocols in a Tauri desktop environment. */
const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function resolveAllowedHref(href: string | undefined | null): string | null {
  if (!href?.trim()) return null;

  try {
    const base =
      typeof window !== 'undefined' && window.location?.href
        ? window.location.href
        : 'https://invalid.invalid/';

    const url = new URL(href, base);
    if (ALLOWED_LINK_PROTOCOLS.has(url.protocol)) return url.toString();
  } catch {
    /* Invalid URL → treat as unsafe */
  }

  return null;
}

/** Process content — apply LaTeX normalization if enabled. */
const useProcessedContent = (content: string, enableLatex: boolean) =>
  useMemo(() => {
    if (!enableLatex) return content;
    let normalized = normalizeLatexDelimiters(content);
    normalized = normalized.replace(/\n{3,}/g, '\n\n');
    return normalized;
  }, [content, enableLatex]);

/** Build remark plugins list based on settings. */
const useRemarkPlugins = (enableLatex: boolean): PluggableList =>
  useMemo(() => {
    const plugins: PluggableList = [remarkGfm];
    if (enableLatex) plugins.push([remarkMath, { singleDollarTextMath: true }]);
    return plugins;
  }, [enableLatex]);

/** Build rehype plugins list based on settings. */
const useRehypePlugins = (enableLatex: boolean): PluggableList =>
  useMemo(() => {
    const plugins: PluggableList = [rehypeHighlight];
    if (enableLatex) {
      plugins.push([
        rehypeKatex,
        {
          throwOnError: false,
          errorColor: '#ef4444',
          strict: false,
          output: 'html',
          trust: false,
        },
      ]);
    }
    return plugins;
  }, [enableLatex]);

/** Markdown component renderers for custom styling and behavior. */
const useMarkdownComponents = (
  enableMermaid: boolean,
  handleLinkClick: (e: React.MouseEvent<HTMLAnchorElement>, href: string) => Promise<void>,
  t: (k: string) => string
) =>
  useMemo(
    () => ({
      p: ({ children }: { children?: React.ReactNode }) => (
        <div className="mbe-4 last:mbe-0 leading-relaxed" dir="auto">
          {children}
        </div>
      ),
      pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
      ul: ({ children }: { children?: React.ReactNode }) => (
        <ul className="mbe-4 list-disc space-y-1 ps-6">{children}</ul>
      ),
      ol: ({ children }: { children?: React.ReactNode }) => (
        <ol className="mbe-4 list-decimal space-y-1 ps-6">{children}</ol>
      ),
      li: ({ children }: { children?: React.ReactNode }) => <li className="mbe-1">{children}</li>,
      blockquote: ({ children }: { children?: React.ReactNode }) => (
        <blockquote className="border-is-4 mbe-4 border-zinc-200 ps-4 text-zinc-500 italic dark:border-zinc-800">
          {children}
        </blockquote>
      ),
      a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) => {
        const safeHref = resolveAllowedHref(href);
        if (!safeHref) {
          return (
            <span
              className="cursor-not-allowed font-medium text-zinc-500"
              title={t('error.unsupportedLink')}
            >
              {children}
            </span>
          );
        }
        return (
          <a
            href={safeHref}
            onClick={(e) => handleLinkClick(e, href || '')}
            className="cursor-pointer font-medium text-blue-500 transition-colors hover:underline"
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
        const language = match ? match[1] : '';

        if (enableMermaid && language === 'mermaid')
          return <MermaidRenderer content={String(children ?? '')} />;
        if (match) return <CodeBlock language={language} value={children} />;

        return (
          <code
            className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-sm text-blue-600 dark:bg-zinc-800 dark:text-blue-400"
            {...props}
          >
            {children}
          </code>
        );
      },
    }),
    [enableMermaid, handleLinkClick, t]
  );

const MarkdownRenderer = ({ content }: MarkdownRendererProps) => {
  const globalSettings = useSettingsStore((s) => s.globalSettings);
  const { t } = useTranslation(globalSettings.language);

  const processedContent = useProcessedContent(content, globalSettings.enableLatex);
  const remarkPlugins = useRemarkPlugins(globalSettings.enableLatex);
  const rehypePlugins = useRehypePlugins(globalSettings.enableLatex);

  const handleLinkClick = useCallback(
    async (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      const safeHref = resolveAllowedHref(href);
      if (!safeHref) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      await opener.openUrl(safeHref);
    },
    []
  );

  const components = useMarkdownComponents(globalSettings.enableMermaid, handleLinkClick, t);

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {processedContent}
    </ReactMarkdown>
  );
};

export default React.memo(MarkdownRenderer);
