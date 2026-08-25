import mermaid from 'mermaid';

type MermaidTheme = 'default' | 'dark' | 'base' | 'forest' | 'neutral';

interface InitializedState {
  theme: MermaidTheme | 'dark';
  isDark: boolean;
}

let initialized: InitializedState | null = null;
let idCounter = 0;

const buildInitConfig = (theme: MermaidTheme | 'dark', isDark: boolean) => {
  return {
    startOnLoad: false,
    theme: isDark ? 'dark' : theme,
    securityLevel: 'strict' as const,
    suppressErrorRendering: true,
    // SVG-mode labels (plain <text>): html labels live in <foreignObject>,
    // which DOMPurify hard-disallows, so they would be stripped entirely.
    htmlLabels: false,
    flowchart: { useMaxWidth: true },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
    pie: { useMaxWidth: true },
    mindmap: { useMaxWidth: true },
    timeline: { useMaxWidth: true },
    xyChart: { useMaxWidth: true },
  };
};

export function initOnce(theme: MermaidTheme = 'default', isDark: boolean): void {
  const resolvedTheme = isDark ? 'dark' : theme;

  if (initialized && initialized.isDark === isDark && initialized.theme === resolvedTheme) {
    return;
  }

  mermaid.initialize(buildInitConfig(resolvedTheme, isDark));
  initialized = { theme: resolvedTheme, isDark };
}

export function resetForThemeChange(theme: MermaidTheme = 'default', isDark: boolean): void {
  const resolvedTheme = isDark ? 'dark' : theme;
  mermaid.initialize(buildInitConfig(resolvedTheme, isDark));
  initialized = { theme: resolvedTheme, isDark };
}

export function nextDiagramId(): string {
  idCounter += 1;
  return `mermaid-diagram-${idCounter}`;
}

export function resetMermaidService(): void {
  initialized = null;
  idCounter = 0;
}
