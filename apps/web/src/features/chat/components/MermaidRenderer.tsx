"use client";

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import mermaid from 'mermaid';

import { extractMermaidContent, detectUnsupportedDiagram, preprocessMermaidContent } from '../utils/mermaid-utils';
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
  <div className={`flex justify-center items-center p-8 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg ${className}`}>
    <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      {label}
    </div>
  </div>
);

/** Error state with copy-source action. */
const MermaidError = ({
  error, className, onCopySource, errorTitle, copyLabel, requirementNote,
}: {
  error: string;
  className: string;
  onCopySource: () => void;
  errorTitle: string;
  copyLabel: string;
  requirementNote: string;
}) => (
  <div className={`p-6 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-xl text-sm ${className}`}>
    <div className="flex justify-between items-start mb-3">
      <div className="font-semibold text-red-700 dark:text-red-400">{errorTitle}</div>
      <button
        onClick={onCopySource}
        className="px-3 py-1 text-xs bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-red-200 dark:border-red-800 rounded-md transition-colors"
      >
        📋 {copyLabel}
      </button>
    </div>
    <pre className="whitespace-pre-wrap font-mono text-xs text-red-600 dark:text-red-500 bg-white dark:bg-zinc-950 p-4 rounded-lg border border-red-100 dark:border-red-900 overflow-auto">
      {error}
    </pre>
    <p className="mt-3 text-xs text-red-500/80" dangerouslySetInnerHTML={{ __html: requirementNote }} />
  </div>
);

/** Rendered diagram display. */
const MermaidDiagram = ({
  svg, containerRef, className,
}: {
  svg: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  className: string;
}) => (
  <div
    ref={containerRef}
    className={`mermaid-container flex justify-center bg-white dark:bg-zinc-950 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-x-auto my-6 shadow-sm ${className}`}
    dangerouslySetInnerHTML={{ __html: svg }}
    aria-label="Rendered Mermaid diagram"
  />
);

/** Hook encapsulating mermaid rendering state and logic. */
const useMermaidRender = (
  mermaidContent: string | null,
  theme: MermaidRendererProps['theme'],
) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const language = useLanguage();
  const { t } = useTranslation(language);

  const renderDiagram = useCallback(async () => {
    if (!mermaidContent || isRendering) return;
    setSvg(''); setError(null); setIsRendering(true);

    const unsupported = detectUnsupportedDiagram(mermaidContent);
    if (unsupported) { setError(unsupported); setIsRendering(false); return; }

    try {
      initMermaid(theme);
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const processedContent = preprocessMermaidContent(mermaidContent);
      const { svg: renderedSvg } = await mermaid.render(id, processedContent);
      setSvg(renderedSvg); setError(null);
    } catch (err: unknown) {
      let message = err instanceof Error ? err.message : String(err);
      if (message.includes('Parse error') || message.includes('Lexer error')) {
        message += `\n\n💡 ${t('settings.markdown.requirementNote').replace(/<\/?code>/g, '')}`;
      }
      setError(message); setSvg('');
      if (containerRef.current) containerRef.current.innerHTML = '';
    } finally { setIsRendering(false); }
  }, [mermaidContent, theme, t, isRendering]);

  useEffect(() => { renderDiagram(); }, [renderDiagram]);

  useEffect(() => {
    return () => {
      setSvg(''); setError(null);
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, []);

  return { containerRef, svg, error, isRendering, t };
};

const MermaidRenderer: React.FC<MermaidRendererProps> = ({
  content, theme = 'default', className = '',
}) => {
  const mermaidContent = useMemo(() => extractMermaidContent(content), [content]);
  const { containerRef, svg, error, isRendering, t } = useMermaidRender(mermaidContent, theme);

  const copySource = useCallback(() => {
    if (mermaidContent) {
      navigator.clipboard.writeText(`\`\`\`mermaid\n${mermaidContent}\n\`\`\``);
    }
  }, [mermaidContent]);

  if (!mermaidContent) return null;

  if (isRendering && !svg) {
    return <MermaidLoading className={className} label={t('settings.markdown.renderingDiagram')} />;
  }

  if (error) {
    return (
      <MermaidError
        error={error} className={className} onCopySource={copySource}
        errorTitle={t('settings.markdown.mermaidError')} copyLabel={t('settings.markdown.copySource')}
        requirementNote={t('settings.markdown.requirementNote')}
      />
    );
  }

  return <MermaidDiagram svg={svg} containerRef={containerRef} className={className} />;
};

export default React.memo(MermaidRenderer);
