'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';

import {
  detectUnsupportedDiagram,
  preprocessMermaidContent,
} from '@/features/conversation/utils/mermaid-utils';
import {
  initOnce,
  resetForThemeChange,
  nextDiagramId,
} from '@/features/conversation/utils/mermaid-service';
import { useSettingsStore, useGlobalSettings } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

/** Simple content hash for caching (FNV-1a 32-bit). */
function contentHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

/** Per-session render cache: contentHash -> { svg, errorMessage }. */
const renderCache = new Map<string, { svg: string; errorMessage: string | null }>();

/** Clear the render cache (for testing). */
export function clearRenderCache(): void {
  renderCache.clear();
}

interface MermaidRendererProps {
  content: string;
  theme?: 'default' | 'dark' | 'base' | 'forest' | 'neutral';
  className?: string;
}

/** Loading state while mermaid renders. */
const MermaidLoading = ({ className, label }: { className: string; label: string }) => (
  <div
    className={`flex items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
  >
    <div className="text-body flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
      <div className="border-bs-transparent h-4 w-4 animate-spin rounded-full border-2 border-current" />
      {label}
    </div>
  </div>
);

/** Parses an i18n string containing <code>...</code> tags into JSX with
 *  styled <code> elements, avoiding dangerouslySetInnerHTML. */
const RequirementNote = ({ note }: { note: string }) => {
  const parts = note.split(/(<code>.*?<\/code>)/g);
  return (
    <p className="text-caption mbs-3 text-red-500/80">
      {parts.map((part, i) => {
        const codeMatch = part.match(/^<code>(.*)<\/code>$/);
        if (codeMatch) {
          return (
            <code
              key={i}
              className="rounded bg-red-100 px-1 py-0.5 font-mono text-red-700 dark:bg-red-900/50 dark:text-red-400"
            >
              {codeMatch[1]}
            </code>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </p>
  );
};

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
    className={`text-body rounded-md border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/50 ${className}`}
  >
    <div className="mbe-3 flex items-start justify-between">
      <div className="font-semibold text-red-700 dark:text-red-400">{errorTitle}</div>
      <Button
        variant="outline"
        size="sm"
        onClick={onCopySource}
        className="text-caption rounded-md border-red-200 bg-white px-3 py-1 hover:bg-zinc-100 dark:border-red-800 dark:bg-zinc-800 dark:hover:bg-zinc-700"
      >
        📋 {copyLabel}
      </Button>
    </div>
    <pre className="text-caption overflow-auto rounded-md border border-red-100 bg-white p-4 font-mono whitespace-pre-wrap text-red-600 dark:border-red-900 dark:bg-zinc-950 dark:text-red-500">
      {error}
    </pre>
    {requirementNote && <RequirementNote note={requirementNote} />}
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
    className={`mermaid-container shadow-native mbs-6 mbe-6 flex justify-center overflow-x-auto rounded-md border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950 ${className}`}
    dangerouslySetInnerHTML={{
      __html: DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: false } }),
    }}
    aria-label={ariaLabel}
  />
);

/** Hook encapsulating mermaid rendering state and logic.
 *
 *  Uses a per-instance generation ref to supersede stale async renders:
 *  when content changes mid-render, the generation counter increments and
 *  the in-flight render's result is discarded when it resolves.
 *  Caches rendered SVGs by content hash + theme + isDark to avoid re-rendering
 *  identical diagrams. */
const useMermaidRender = (
  mermaidContent: string,
  theme: MermaidRendererProps['theme'],
  isDark: boolean
) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const generationRef = useRef(0);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);

  // Cache key includes theme and isDark since they affect output
  const cacheKey = useMemo(
    () => `${contentHash(mermaidContent)}|${theme}|${isDark}`,
    [mermaidContent, theme, isDark]
  );

  // Check cache on mount and when cache key changes
  useEffect(() => {
    const cached = renderCache.get(cacheKey);
    if (cached) {
      setSvg(cached.svg);
      setErrorMessage(cached.errorMessage);
      setIsRendering(false);
    }
  }, [cacheKey]);

  const renderDiagram = useCallback(async () => {
    if (!mermaidContent) return;

    // Check cache again in case it was populated by another instance
    const cached = renderCache.get(cacheKey);
    if (cached) {
      setSvg(cached.svg);
      setErrorMessage(cached.errorMessage);
      setIsRendering(false);
      return;
    }

    const generation = ++generationRef.current;
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
      initOnce(theme, isDark);
      const id = nextDiagramId();
      const processedContent = preprocessMermaidContent(mermaidContent);
      const { svg: renderedSvg } = await mermaid.render(id, processedContent);

      if (generation !== generationRef.current) return;

      setSvg(renderedSvg);
      setErrorMessage(null);
      // Cache successful render
      renderCache.set(cacheKey, { svg: renderedSvg, errorMessage: null });
    } catch (err: unknown) {
      if (generation !== generationRef.current) return;

      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      setSvg('');
      // Cache error to avoid re-trying
      renderCache.set(cacheKey, { svg: '', errorMessage: message });
    } finally {
      if (generation === generationRef.current) {
        setIsRendering(false);
      }
    }
  }, [mermaidContent, theme, isDark, cacheKey]);

  useEffect(() => {
    renderDiagram();
  }, [renderDiagram]);

  return { containerRef, svg, errorMessage, isRendering, t };
};

/** Maps settings theme ('light' | 'dark' | 'system') to mermaid theme + isDark flag. */
const resolveMermaidTheme = (
  settingsTheme: 'light' | 'dark' | 'system'
): { mermaidTheme: 'default' | 'dark' | 'base' | 'forest' | 'neutral'; isDark: boolean } => {
  if (settingsTheme === 'dark') {
    return { mermaidTheme: 'dark', isDark: true };
  }
  if (settingsTheme === 'light') {
    return { mermaidTheme: 'default', isDark: false };
  }
  // system - detect from document
  const isDark =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  return { mermaidTheme: isDark ? 'dark' : 'default', isDark };
};

const MermaidRenderer: React.FC<MermaidRendererProps> = ({ content, className = '' }) => {
  const mermaidContent = content.trim();
  const globalSettings = useGlobalSettings();
  const { mermaidTheme, isDark } = resolveMermaidTheme(globalSettings.theme);
  const { containerRef, svg, errorMessage, isRendering, t } = useMermaidRender(
    mermaidContent,
    mermaidTheme,
    isDark
  );
  // Only requirementDiagram failures get the strict-keywords note
  const showsRequirementNote = useMemo(
    () => preprocessMermaidContent(mermaidContent).startsWith('requirementDiagram'),
    [mermaidContent]
  );

  // Reset mermaid when theme changes
  useEffect(() => {
    resetForThemeChange(mermaidTheme, isDark);
  }, [mermaidTheme, isDark]);

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
        requirementNote={showsRequirementNote ? t('settings.markdown.requirementNote') : ''}
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
