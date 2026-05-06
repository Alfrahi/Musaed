'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import mermaid from 'mermaid';

import {
  extractMermaidContent,
  detectUnsupportedDiagram,
  preprocessMermaidContent,
} from '../utils/mermaid-utils';
import { useLanguage } from '../../../store/hooks';
import { useTranslation } from '../../../lib/i18n';

interface MermaidRendererProps {
  content: string;
  theme?: 'default' | 'dark' | 'base' | 'forest' | 'neutral';
  className?: string;
}

/** Initialize mermaid with theme-aware configuration. */
const initMermaid = (theme: MermaidRendererProps['theme']) => {
  const isDark = document.documentElement.classList.contains('dark');

  mermaid.initialize({
    startOnLoad: false,
    theme: (isDark ? 'dark' : theme) as 'dark' | 'default',
    securityLevel: 'loose',
    suppressErrorRendering: true,
    flowchart: { useMaxWidth: true, htmlLabels: true },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
    pie: { useMaxWidth: true },
    mindmap: { useMaxWidth: true },
    timeline: { useMaxWidth: true },
    xyChart: { useMaxWidth: true },
  });
};

/** Loading state while mermaid renders. */
const MermaidLoading = ({ className, label }: { className: string; label: string }) => (
  <div
    className={`flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
  >
    <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}
    </div>
  </div>
);

/** Error state with copy-source action. */
const MermaidError = ({
  error,
  className,
  onCopySource,
  errorTitle,
  copyLabel,
  requirementNote,
}: {
  error: string;
  className: string;
  onCopySource: () => void;
  errorTitle: string;
  copyLabel: string;
  requirementNote: string;
}) => (
  <div
    className={`rounded-xl border border-red-200 bg-red-50 p-6 text-sm dark:border-red-900 dark:bg-red-950/50 ${className}`}
  >
    <div className="mb-3 flex items-start justify-between">
      <div className="font-semibold text-red-700 dark:text-red-400">{errorTitle}</div>
      <button
        onClick={onCopySource}
        className="rounded-md border border-red-200 bg-white px-3 py-1 text-xs transition-colors hover:bg-zinc-100 dark:border-red-800 dark:bg-zinc-800 dark:hover:bg-zinc-700"
      >
        📋 {copyLabel}
      </button>
    </div>
    <pre className="overflow-auto rounded-lg border border-red-100 bg-white p-4 font-mono text-xs whitespace-pre-wrap text-red-600 dark:border-red-900 dark:bg-zinc-950 dark:text-red-500">
      {error}
    </pre>
    <p
      className="mt-3 text-xs text-red-500/80"
      dangerouslySetInnerHTML={{ __html: requirementNote }}
    />
  </div>
);

/** Rendered diagram display. */
const MermaidDiagram = ({
  svg,
  containerRef,
  className,
  ariaLabel,
}: {
  svg: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  className: string;
  ariaLabel: string;
}) => (
  <div
    ref={containerRef}
    className={`mermaid-container my-6 flex justify-center overflow-x-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 ${className}`}
    dangerouslySetInnerHTML={{ __html: svg }}
    aria-label={ariaLabel}
  />
);

/** Hook encapsulating mermaid rendering state and logic. */
const useMermaidRender = (mermaidContent: string | null, theme: MermaidRendererProps['theme']) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const language = useLanguage();
  const { t } = useTranslation(language);

  const renderDiagram = useCallback(async () => {
    if (!mermaidContent || isRendering) return;
    setSvg('');
    setErrorMessage(null);
    setIsRendering(true);

    const unsupported = detectUnsupportedDiagram(mermaidContent);
    if (unsupported) {
      setErrorMessage(unsupported);
      setIsRendering(false);
      return;
    }

    try {
      initMermaid(theme);
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const processedContent = preprocessMermaidContent(mermaidContent);
      const { svg: renderedSvg } = await mermaid.render(id, processedContent);
      setSvg(renderedSvg);
      setErrorMessage(null);
    } catch (err: unknown) {
      let message = err instanceof Error ? err.message : String(err);
      if (message.includes('Parse error') || message.includes('Lexer error')) {
        message += `\n\n💡 ${t('settings.markdown.requirementNote').replace(/<\/?code>/g, '')}`;
      }
      setErrorMessage(message);
      setSvg('');
      if (containerRef.current) containerRef.current.innerHTML = '';
    } finally {
      setIsRendering(false);
    }
  }, [mermaidContent, theme, t, isRendering]);

  useEffect(() => {
    renderDiagram();
  }, [renderDiagram]);

  useEffect(() => {
    const container = containerRef.current;
    return () => {
      setSvg('');
      setErrorMessage(null);
      if (container) container.innerHTML = '';
    };
  }, []);

  return { containerRef, svg, errorMessage, isRendering, t };
};

const MermaidRenderer: React.FC<MermaidRendererProps> = ({
  content,
  theme = 'default',
  className = '',
}) => {
  const mermaidContent = useMemo(() => extractMermaidContent(content), [content]);
  const { containerRef, svg, errorMessage, isRendering, t } = useMermaidRender(
    mermaidContent,
    theme
  );

  const copySource = useCallback(() => {
    if (mermaidContent) {
      navigator.clipboard.writeText(`\`\`\`mermaid\n${mermaidContent}\n\`\`\``);
    }
  }, [mermaidContent]);

  if (!mermaidContent) return null;

  if (isRendering && !svg) {
    return <MermaidLoading className={className} label={t('settings.markdown.renderingDiagram')} />;
  }

  if (errorMessage) {
    return (
      <MermaidError
        error={errorMessage}
        className={className}
        onCopySource={copySource}
        errorTitle={t('settings.markdown.mermaidError')}
        copyLabel={t('settings.markdown.copySource')}
        requirementNote={t('settings.markdown.requirementNote')}
      />
    );
  }

  return (
    <MermaidDiagram
      svg={svg}
      containerRef={containerRef}
      className={className}
      ariaLabel={t('a11y.mermaidDiagram')}
    />
  );
};

export default React.memo(MermaidRenderer);
