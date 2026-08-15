import mermaid from 'mermaid';

type MermaidTheme = 'default' | 'dark' | 'base' | 'forest' | 'neutral';

interface InitializedState {
  theme: MermaidTheme | 'dark';
  isDark: boolean;
}

let initialized: InitializedState | null = null;
let idCounter = 0;

const isDarkMode = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

const buildInitConfig = (theme: MermaidTheme | 'dark') => {
  const isDark = isDarkMode();
  return {
    startOnLoad: false,
    theme: isDark ? 'dark' : theme,
    securityLevel: 'strict' as const,
    suppressErrorRendering: true,
    flowchart: { useMaxWidth: true, htmlLabels: true },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
    pie: { useMaxWidth: true },
    mindmap: { useMaxWidth: true },
    timeline: { useMaxWidth: true },
    xyChart: { useMaxWidth: true },
  };
};

export function initOnce(theme: MermaidTheme = 'default'): void {
  const isDark = isDarkMode();
  const resolvedTheme = isDark ? 'dark' : theme;

  if (initialized && initialized.isDark === isDark && initialized.theme === resolvedTheme) {
    return;
  }

  mermaid.initialize(buildInitConfig(theme));
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
