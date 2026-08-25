import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockMermaidRender, mockMermaidInitialize } = vi.hoisted(() => ({
  mockMermaidRender: vi.fn(),
  mockMermaidInitialize: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: mockMermaidInitialize,
    render: mockMermaidRender,
  },
}));

const { mockT } = vi.hoisted(() => ({
  mockT: vi.fn((key: string) => key),
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: mockT,
    formatNumber: (n: number) => String(n),
    formatDate: (d: number | Date) => String(d),
    isRtl: false,
    formatFileSize: (b: number) => `${b} B`,
  }),
}));

vi.mock('@/store', () => ({
  useSettingsStore: (selector: (s: { globalSettings: { language: string } }) => string) =>
    selector({ globalSettings: { language: 'en' } }),
  useGlobalSettings: () => ({ theme: 'system', language: 'en' }),
}));

vi.mock('dompurify', () => ({
  default: {
    sanitize: (svg: string) => svg,
  },
}));

import MermaidRenderer from './MermaidRenderer';
import { resetMermaidService } from '@/features/conversation/utils/mermaid-service';
import { clearRenderCache } from './MermaidRenderer';

const validSvg = '<svg>diagram</svg>';
const flowchartContent = 'flowchart TD\n  A --> B';

describe('MermaidRenderer', () => {
  beforeEach(() => {
    mockMermaidInitialize.mockClear();
    mockMermaidRender.mockReset();
    mockT.mockReset();
    mockT.mockImplementation((key: string) => key);
    resetMermaidService();
    clearRenderCache();
  });

  afterEach(() => {
    resetMermaidService();
    clearRenderCache();
  });

  it('renders a valid diagram as sanitized SVG', async () => {
    mockMermaidRender.mockResolvedValue({ svg: validSvg });

    render(<MermaidRenderer content={flowchartContent} />);

    await waitFor(() => {
      expect(screen.getByLabelText('a11y.mermaidDiagram')).toBeTruthy();
    });
    expect(screen.getByLabelText('a11y.mermaidDiagram').innerHTML).toBe(validSvg);
  });

  it('shows loading state while rendering', async () => {
    let resolveRender: (value: { svg: string }) => void;
    mockMermaidRender.mockReturnValue(
      new Promise<{ svg: string }>((resolve) => {
        resolveRender = resolve;
      })
    );

    render(<MermaidRenderer content={flowchartContent} />);

    await waitFor(() => {
      expect(screen.getByText('settings.markdown.renderingDiagram')).toBeTruthy();
    });

    await act(async () => {
      resolveRender!({ svg: validSvg });
    });

    await waitFor(() => {
      expect(screen.getByLabelText('a11y.mermaidDiagram')).toBeTruthy();
    });
  });

  it('shows error state for invalid syntax', async () => {
    mockMermaidRender.mockRejectedValue(new Error('Parse error: unexpected token'));

    render(<MermaidRenderer content="invalid mermaid syntax" />);

    await waitFor(() => {
      expect(screen.getByText('settings.markdown.mermaidError')).toBeTruthy();
    });
    expect(screen.getByText(/Parse error: unexpected token/)).toBeTruthy();
  });

  it('shows requirement note for requirementDiagram errors', async () => {
    mockT.mockImplementation((key: string) => {
      if (key === 'settings.markdown.requirementNote') {
        return 'requirementDiagram is strict — relationships must use keywords like <code>satisfies</code>, <code>verifies</code>, etc.';
      }
      return key;
    });
    mockMermaidRender.mockRejectedValue(new Error('Parse error'));

    render(<MermaidRenderer content={'requirementDiagram\n  req1 - satisfies -> req2'} />);

    await waitFor(() => {
      expect(screen.getByText('settings.markdown.mermaidError')).toBeTruthy();
    });

    expect(screen.getByText('satisfies')).toBeTruthy();
    expect(screen.getByText('verifies')).toBeTruthy();
  });

  it('omits requirement note for non-requirement diagram errors', async () => {
    mockT.mockImplementation((key: string) => {
      if (key === 'settings.markdown.requirementNote') {
        return 'requirementDiagram is strict — relationships must use keywords like <code>satisfies</code>, <code>verifies</code>, etc.';
      }
      return key;
    });
    mockMermaidRender.mockRejectedValue(new Error('Parse error'));

    render(<MermaidRenderer content="flowchart TD\n  A --> B" />);

    await waitFor(() => {
      expect(screen.getByText('settings.markdown.mermaidError')).toBeTruthy();
    });

    expect(screen.queryByText('satisfies')).toBeNull();
    expect(screen.queryByText('verifies')).toBeNull();
  });

  it('processes content through preprocessMermaidContent before rendering', async () => {
    mockMermaidRender.mockResolvedValue({ svg: validSvg });

    render(<MermaidRenderer content={flowchartContent} />);

    await waitFor(() => {
      expect(screen.getByLabelText('a11y.mermaidDiagram')).toBeTruthy();
    });
    expect(mockMermaidRender).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('flowchart TD')
    );
  });

  it('returns null for empty content', () => {
    const { container } = render(<MermaidRenderer content="   " />);
    expect(container.firstChild).toBeNull();
  });

  it('re-renders when content changes (not blocked by in-flight render)', async () => {
    const firstContent = 'sequenceDiagram\n  Alice->>Bob: Hello';
    const secondContent = 'sequenceDiagram\n  Alice->>Bob: Hi';
    const secondSvg = '<svg>second</svg>';

    let resolveSecond: (value: { svg: string }) => void;

    mockMermaidRender.mockImplementation((_id: string, content: string) => {
      if (content.includes('Hello')) {
        return new Promise<{ svg: string }>(() => {
          // Never resolves — simulates an in-flight render
        });
      }
      return new Promise<{ svg: string }>((resolve) => {
        resolveSecond = resolve;
      });
    });

    const { rerender } = render(<MermaidRenderer content={firstContent} />);

    await waitFor(() => {
      expect(screen.getByText('settings.markdown.renderingDiagram')).toBeTruthy();
    });

    rerender(<MermaidRenderer content={secondContent} />);

    await act(async () => {
      resolveSecond!({ svg: secondSvg });
    });

    await waitFor(() => {
      expect(screen.getByLabelText('a11y.mermaidDiagram')).toBeTruthy();
      expect(screen.getByLabelText('a11y.mermaidDiagram').innerHTML).toBe(secondSvg);
    });
  });

  it('discards stale render result when content changes mid-render', async () => {
    const firstContent = 'sequenceDiagram\n  Alice->>Bob: Hello';
    const secondContent = 'sequenceDiagram\n  Alice->>Bob: Hi';
    const firstSvg = '<svg>stale</svg>';
    const secondSvg = '<svg>fresh</svg>';

    let resolveFirst: (value: { svg: string }) => void;
    let resolveSecond: (value: { svg: string }) => void;

    mockMermaidRender.mockImplementation((_id: string, content: string) => {
      if (content.includes('Hello')) {
        return new Promise<{ svg: string }>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return new Promise<{ svg: string }>((resolve) => {
        resolveSecond = resolve;
      });
    });

    const { rerender } = render(<MermaidRenderer content={firstContent} />);

    rerender(<MermaidRenderer content={secondContent} />);

    await act(async () => {
      resolveSecond!({ svg: secondSvg });
    });

    await act(async () => {
      resolveFirst!({ svg: firstSvg });
    });

    await waitFor(() => {
      expect(screen.getByLabelText('a11y.mermaidDiagram')).toBeTruthy();
      expect(screen.getByLabelText('a11y.mermaidDiagram').innerHTML).toBe(secondSvg);
    });
  });

  it('initializes mermaid on mount and re-initializes on theme change', async () => {
    mockMermaidRender.mockResolvedValue({ svg: validSvg });

    const { rerender } = render(<MermaidRenderer content={flowchartContent} />);

    await waitFor(() => {
      expect(screen.getByLabelText('a11y.mermaidDiagram')).toBeTruthy();
    });

    // First render: initOnce + resetForThemeChange on mount = 2 calls
    expect(mockMermaidInitialize).toHaveBeenCalledTimes(2);

    rerender(<MermaidRenderer content="sequenceDiagram\n  Alice->>Bob: Hi" />);

    await waitFor(() => {
      expect(screen.getByLabelText('a11y.mermaidDiagram')).toBeTruthy();
    });

    // Second render with same theme: no additional calls
    expect(mockMermaidInitialize).toHaveBeenCalledTimes(2);
  });

  it('provides a copy source button in error state', async () => {
    mockMermaidRender.mockRejectedValue(new Error('Parse error'));

    render(<MermaidRenderer content={flowchartContent} />);

    await waitFor(() => {
      expect(screen.getByText(/settings\.markdown\.copySource/)).toBeTruthy();
    });
  });

  it('caches rendered SVG and avoids re-rendering on same content', async () => {
    mockMermaidRender.mockResolvedValue({ svg: validSvg });

    const { rerender } = render(<MermaidRenderer content={flowchartContent} />);

    await waitFor(() => {
      expect(screen.getByLabelText('a11y.mermaidDiagram')).toBeTruthy();
    });

    // First render calls mermaid.render
    expect(mockMermaidRender).toHaveBeenCalledTimes(1);

    // Re-render with same content should use cache
    rerender(<MermaidRenderer content={flowchartContent} />);

    await waitFor(() => {
      expect(screen.getByLabelText('a11y.mermaidDiagram')).toBeTruthy();
    });

    // mermaid.render should NOT be called again (cached)
    expect(mockMermaidRender).toHaveBeenCalledTimes(1);
  });

  it('re-renders when content changes (cache miss)', async () => {
    mockMermaidRender.mockResolvedValue({ svg: validSvg });

    const { rerender } = render(<MermaidRenderer content={flowchartContent} />);

    await waitFor(() => {
      expect(screen.getByLabelText('a11y.mermaidDiagram')).toBeTruthy();
    });

    expect(mockMermaidRender).toHaveBeenCalledTimes(1);

    // Change content
    const newContent = 'sequenceDiagram\n  Alice->>Bob: Hi';
    rerender(<MermaidRenderer content={newContent} />);

    await waitFor(() => {
      expect(screen.getByLabelText('a11y.mermaidDiagram')).toBeTruthy();
    });

    // mermaid.render should be called again (cache miss)
    expect(mockMermaidRender).toHaveBeenCalledTimes(2);
  });
});
