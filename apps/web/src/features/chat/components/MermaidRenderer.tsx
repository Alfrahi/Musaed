"use client";

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import mermaid from 'mermaid';

interface MermaidRendererProps {
  content: string;
  theme?: 'default' | 'dark' | 'base' | 'forest' | 'neutral';
  className?: string;
}

const SUPPORTED_DIAGRAM_TYPES = [
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'stateDiagram-v2',
  'erDiagram', 'journey', 'gantt', 'pie', 'mindmap', 'timeline', 'gitGraph', 'requirementDiagram',
  'architecture', 'block', 'c4Diagram', 'xyChart', 'sankey-beta', 'quadrantChart', 'radarChart',
  'barChart', 'packetDiagram', 'blockDiagram', 'dependencyGraph'
] as const;

const MermaidRenderer: React.FC<MermaidRendererProps> = ({
  content,
  theme = 'default',
  className = ''
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  const mermaidContent = useMemo(() => {
    if (!content?.trim()) return '';

    let match = content.match(/```mermaid\s*([\s\S]*?)```/i);
    if (!match) {
      match = content.match(/```\s*([\s\S]*?)```/);
    }

    if (match?.[1]) return match[1].trim();

    const looksLikeMermaid = SUPPORTED_DIAGRAM_TYPES.some((type) =>
      content.trim().startsWith(type) || content.includes(type)
    );

    return looksLikeMermaid ? content.trim() : '';
  }, [content]);

  const preprocessMermaidContent = useCallback((raw: string): string => {
    let processed = raw.trim();

    // Convert invalid top-level types
    if (/^(cluster|dependencyGraph)/im.test(processed)) {
      processed = processed.replace(/^(cluster|dependencyGraph)\b/im, 'flowchart TD');
    }

    // === REQUIREMENT DIAGRAM - IMPROVED ===
    if (processed.includes('requirementDiagram')) {
      const lines = processed.split('\n');
      const newLines: string[] = [];

      for (let line of lines) {
        const trimmed = line.trim();

        if (!trimmed) {
          newLines.push(line);
          continue;
        }

        // Auto-fix simple arrows --> into valid requirement relationship
        if (trimmed.match(/\w+\s*-->\s*\w+/)) {
          const fixed = trimmed.replace(/(\w+)\s*-->\s*(\w+)/, '$1 - satisfies -> $2');
          newLines.push('    ' + fixed);  // indent for readability
          continue;
        }

        // Fix property values (add quotes when needed)
        if (trimmed.includes(':') && !trimmed.includes('- ')) {
          const [key, ...valueParts] = trimmed.split(':');
          let value = valueParts.join(':').trim();

          if (value && !/^["'].*["']$/.test(value)) {
            if (/\s/.test(value) || /["':]/.test(value)) {
              value = `"${value}"`;
            }
          }
          newLines.push(`        ${key.trim()}: ${value}`);
        } else {
          newLines.push(line);
        }
      }
      processed = newLines.join('\n');
    }

    // General safe quote fix for other diagrams
    if (!processed.includes('requirementDiagram')) {
      processed = processed.replace(/(\s|^)'([^'\n]+)'(?=\s|$|[;,\]{}])/g, '$1"$2"');
    }

    // ER Diagram
    if (processed.includes('erDiagram')) {
      processed = processed.replace(/(\w+)\s*\{([^}]+)\}/g, (_, entity, attrs) => {
        const formatted = attrs.trim().split('\n').map((l: string) => `        ${l.trim()}`).join('\n');
        return `${entity} {\n${formatted}\n    }`;
      });
    }

    // Quadrant Chart
    if (processed.includes('quadrantChart')) {
      processed = processed.replace(/"([^"]+)"\s*:\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/g, '"$1": [$2, $3]');
      if (!/x-axis/i.test(processed)) processed = processed.replace(/^(quadrantChart\s*)/im, '$1\n  x-axis Low --> High\n');
      if (!/y-axis/i.test(processed)) processed = processed.replace(/^(quadrantChart\s*)/im, '$1\n  y-axis Low --> High\n');
    }

    // Gantt
    if (processed.includes('gantt')) {
      if (!/dateFormat/i.test(processed)) processed = processed.replace(/^(gantt\b)/im, '$1\n  dateFormat YYYY-MM-DD');
      if (!/axisFormat/i.test(processed)) processed = processed.replace(/^(gantt\b)/im, '$1\n  axisFormat %Y-%m-%d');

      processed = processed.replace(
        /^(\s*)([^:\n]+?)\s*:\s*(?![\d-]|after|crit|done|milestone|active)([^,\n]+?)(?:,\s*([^\n]+))?$/gm,
        (_, indent, taskName, __, durationPart) => {
          const cleanTask = taskName.trim();
          const duration = (durationPart?.trim() || '7d').replace(/^\s*,\s*/, '');
          return `${indent}${cleanTask} : 2026-01-01, ${duration}`;
        }
      );
    }

    // Flowchart / Graph
    if (/^(flowchart|graph)/im.test(processed)) {
      processed = processed.replace(/^(flowchart|graph)\s+\w*/im, 'flowchart TD');
      processed = processed.replace(/->>/g, '-->');
      processed = processed.replace(/([^\n;}])\s*$/gm, '$1;');
    }

    // Pie
    if (processed.includes('pie')) {
      processed = processed.replace(/(\d+(?:\.\d+)?)%/g, '$1');
    }

    return processed;
  }, []);

  const renderMermaid = useCallback(async () => {
    if (!mermaidContent) {
      setSvg('');
      setError(null);
      return;
    }

    setIsRendering(true);
    setError(null);

    try {
      const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : theme;

      mermaid.initialize({
        startOnLoad: false,
        theme: currentTheme as any,
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

      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const processedContent = preprocessMermaidContent(mermaidContent);

      const { svg: renderedSvg } = await mermaid.render(id, processedContent);

      setSvg(renderedSvg);
      setError(null);
    } catch (err: any) {
      console.error('Mermaid render error:', err);

      let message = err.message || String(err);

      if (message.includes('Parse error') || message.includes('Lexer error')) {
        message += '\n\n💡 For requirementDiagram:\n';
        message += '   • Use " - satisfies -> ", " - verifies -> ", etc.\n';
        message += '   • Your original --> was automatically converted to " - satisfies -> "';
      }

      setError(message);
      setSvg('');

      if (containerRef.current) containerRef.current.innerHTML = '';
    } finally {
      setIsRendering(false);
    }
  }, [mermaidContent, preprocessMermaidContent, theme]);

  useEffect(() => { renderMermaid(); }, [renderMermaid]);

  useEffect(() => {
    return () => {
      setSvg('');
      setError(null);
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, []);

  const copySource = () => {
    if (mermaidContent) {
      navigator.clipboard.writeText(`\`\`\`mermaid\n${mermaidContent}\n\`\`\``);
      alert('Mermaid source copied to clipboard');
    }
  };

  if (!mermaidContent) return null;

  if (isRendering && !svg) {
    return (
      <div className={`flex justify-center items-center p-8 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg ${className}`}>
        <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Rendering diagram...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-6 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-xl text-sm ${className}`}>
        <div className="flex justify-between items-start mb-3">
          <div className="font-semibold text-red-700 dark:text-red-400">Mermaid Rendering Error</div>
          <button
            onClick={copySource}
            className="px-3 py-1 text-xs bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-red-200 dark:border-red-800 rounded-md transition-colors"
          >
            📋 Copy Source
          </button>
        </div>

        <pre className="whitespace-pre-wrap font-mono text-xs text-red-600 dark:text-red-500 bg-white dark:bg-zinc-950 p-4 rounded-lg border border-red-100 dark:border-red-900 overflow-auto">
          {error}
        </pre>

        <p className="mt-3 text-xs text-red-500/80">
          requirementDiagram is strict — relationships must use keywords like <code>satisfies</code>, <code>verifies</code>, etc.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`mermaid-container flex justify-center bg-white dark:bg-zinc-950 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-x-auto my-6 shadow-sm ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
      aria-label="Rendered Mermaid diagram"
    />
  );
};

export default React.memo(MermaidRenderer);
