import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  useSettingsStore: (
    selector: (s: {
      globalSettings: { language: string; enableLatex: boolean; enableMermaid: boolean };
    }) => string | boolean
  ) => selector({ globalSettings: { language: 'en', enableLatex: true, enableMermaid: true } }),
  useGlobalSettings: () => ({ theme: 'system', language: 'en' }),
}));

vi.mock('dompurify', () => ({
  default: {
    sanitize: (svg: string) => svg,
  },
}));

import MarkdownRenderer from './MarkdownRenderer';

vi.mock('./MermaidRenderer', () => ({
  default: ({ content }: { content: string }) => (
    <div
      data-testid="mermaid-diagram"
      className="mermaid-container"
      aria-label="a11y.mermaidDiagram"
    >
      {content}
    </div>
  ),
}));

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    mockT.mockReset();
    mockT.mockImplementation((key: string) => key);
  });

  const inlineMath = 'Inline $a + b$ math';
  const blockMath = '$$E = mc^2$$';
  const textDollar = 'Price is $5 only';
  const mermaidContent = 'flowchart TD\n  A --> B';
  const mermaidCodeFence = `\`\`\`mermaid\n${mermaidContent}\n\`\`\``;
  const allowedLink = '[Allowed](https://github.com/user/repo)';
  const blockedLink = '[Blocked](javascript:alert(1))';
  const gfmTable = '| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1 | Cell 2 |';
  const boldItalic = '**Bold** and *italic* text';
  const codeBlock = `\`\`\`js\nconst x = 1;\n\`\`\``;
  const inlineCode = 'Use `console.log()` to debug';
  const blockquote = '> This is a quote';
  const unorderedList = '- Item 1\n- Item 2';
  const orderedList = '1. First\n2. Second';
  const headings = '# Heading 1\n## Heading 2';
  const horizontalRule = '---\nText after rule';
  const taskList = '- [x] Done\n- [ ] Todo';
  // const strikethrough = '~~strikethrough~~';
  // const autolink = 'https://example.com';
  const footnotes = 'Text[^1]\n\n[^1]: Footnote';
  const definitionList = 'Term\n: Definition';

  it('renders inline math with single dollar delimiters', async () => {
    render(<MarkdownRenderer content={inlineMath} />);
    await waitFor(() => {
      expect(screen.getByText((content: string) => content.includes('Inline'))).toBeTruthy();
    });
    expect(screen.getByText((content: string) => content.includes('a + b'))).toBeTruthy();
  });

  it('renders block math with double dollar delimiters', async () => {
    render(<MarkdownRenderer content={blockMath} />);
    await waitFor(() => {
      expect(screen.getByText((content: string) => content.includes('E = mc^2'))).toBeTruthy();
    });
  });

  it('does not render $5 as math (text dollar)', async () => {
    render(<MarkdownRenderer content={textDollar} />);
    await waitFor(() => {
      expect(screen.getByText('Price is $5 only')).toBeTruthy();
    });
  });

  it('renders Mermaid code fence', async () => {
    render(<MarkdownRenderer content={mermaidCodeFence} />);
    await waitFor(() => {
      expect(screen.getByLabelText('a11y.mermaidDiagram')).toBeTruthy();
    });
  });

  it('allows allowed links from allowlist', async () => {
    render(<MarkdownRenderer content={allowedLink} />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Allowed' })).toHaveAttribute(
        'href',
        'https://github.com/user/repo'
      );
    });
  });

  it('blocks disallowed links from allowlist', async () => {
    render(<MarkdownRenderer content={blockedLink} />);
    await waitFor(() => {
      expect(screen.getByText('Blocked')).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'Blocked' })).not.toBeInTheDocument();
    });
  });

  it('renders GFM tables', async () => {
    render(<MarkdownRenderer content={gfmTable} />);
    await waitFor(() => {
      expect(screen.getByText('Header 1')).toBeTruthy();
      expect(screen.getByText('Cell 1')).toBeTruthy();
    });
  });

  it('renders bold and italic markdown', async () => {
    render(<MarkdownRenderer content={boldItalic} />);
    await waitFor(() => {
      expect(screen.getByText('Bold')).toBeTruthy();
      expect(screen.getByText('italic')).toBeTruthy();
    });
  });

  it('renders code blocks with syntax highlighting', async () => {
    render(<MarkdownRenderer content={codeBlock} />);
    await waitFor(() => {
      // Syntax highlighter splits code into multiple spans, so match on keyword
      expect(screen.getByText((content: string) => content.includes('const'))).toBeTruthy();
    });
  });

  it('renders inline code', async () => {
    render(<MarkdownRenderer content={inlineCode} />);
    await waitFor(() => {
      expect(screen.getByText('console.log()')).toBeTruthy();
    });
  });

  it('renders blockquotes', async () => {
    render(<MarkdownRenderer content={blockquote} />);
    await waitFor(() => {
      expect(screen.getByText('This is a quote')).toBeTruthy();
    });
  });

  it('renders unordered lists', async () => {
    render(<MarkdownRenderer content={unorderedList} />);
    await waitFor(() => {
      expect(screen.getByText('Item 1')).toBeTruthy();
      expect(screen.getByText('Item 2')).toBeTruthy();
    });
  });

  it('renders ordered lists', async () => {
    render(<MarkdownRenderer content={orderedList} />);
    await waitFor(() => {
      expect(screen.getByText('First')).toBeTruthy();
      expect(screen.getByText('Second')).toBeTruthy();
    });
  });

  it('renders headings', async () => {
    render(<MarkdownRenderer content={headings} />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Heading 1' })).toBeTruthy();
      expect(screen.getByRole('heading', { level: 2, name: 'Heading 2' })).toBeTruthy();
    });
  });

  it('renders horizontal rule', async () => {
    render(<MarkdownRenderer content={horizontalRule} />);
    await waitFor(() => {
      expect(screen.getByText('Text after rule')).toBeTruthy();
    });
  });

  it('renders task lists', async () => {
    render(<MarkdownRenderer content={taskList} />);
    await waitFor(() => {
      expect(screen.getByText('Done')).toBeTruthy();
      expect(screen.getByText('Todo')).toBeTruthy();
    });
  });

  it('renders strikethrough', async () => {
    render(<MarkdownRenderer content="~~strikethrough~~" />);
    await waitFor(() => {
      expect(screen.getByText('strikethrough')).toBeTruthy();
    });
  });

  it('renders autolinks', async () => {
    render(<MarkdownRenderer content="https://example.com" />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'https://example.com' })).toBeTruthy();
    });
  });

  it('renders footnotes', async () => {
    render(<MarkdownRenderer content={footnotes} />);
    await waitFor(() => {
      expect(screen.getByText('Text')).toBeTruthy();
    });
  });

  it('renders definition lists', async () => {
    render(<MarkdownRenderer content={definitionList} />);
    await waitFor(() => {
      // Definition list may render as paragraph depending on remark-gfm version
      expect(screen.getByText((content: string) => content.includes('Term'))).toBeTruthy();
      expect(screen.getByText((content: string) => content.includes('Definition'))).toBeTruthy();
    });
  });

  it('handles empty content', () => {
    const { container } = render(<MarkdownRenderer content="" />);
    expect(container).toBeTruthy();
  });

  it('handles content with only whitespace', () => {
    const { container } = render(<MarkdownRenderer content="   \n\n  " />);
    expect(container).toBeTruthy();
  });
});
