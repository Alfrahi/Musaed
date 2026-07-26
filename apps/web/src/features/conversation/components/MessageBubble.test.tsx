import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Message } from '@musaed/contracts';
import MessageBubble from './MessageBubble';

// The citation chip mounts FileChunkViewer in a modal. Mock it to a stub so
// the test doesn't pull in the full RAG IPC pipeline.
vi.mock('@/features/rag', () => ({
  FileChunkViewer: ({
    filePath,
    targetStartLine,
  }: {
    filePath: string;
    targetStartLine?: number;
  }) => (
    <div data-testid="file-chunk-viewer-stub">
      fc:{filePath} @{targetStartLine}
    </div>
  ),
}));

vi.mock('@/features/conversation/hooks/useMessageActions', () => ({
  useMessageActions: () => ({ copied: false, handleCopy: vi.fn(), tps: null }),
}));

vi.mock('./MessageContent', () => ({
  default: ({ message }: { message: Message }) => <div>{message.content}</div>,
}));

vi.mock('@/lib/i18n', async () => {
  const actual = await vi.importActual('@/lib/i18n');
  return {
    ...(actual as object),
    useTranslation: () => ({
      t: (key: string, values?: Record<string, string | number | boolean>) => {
        if (key === 'a11y.openSource' && values) {
          return `open ${values.file} ${values.startLine}-${values.endLine}`;
        }
        if (key === 'a11y.showNMoreSources' && values) {
          return `Show ${values.count} more…`;
        }
        return key;
      },
      formatNumber: (num: number) => num.toString(),
      formatDate: (date: number | Date) => String(date),
      isRtl: false,
      formatFileSize: (bytes: number) => `${bytes} B`,
    }),
  };
});

vi.mock('@/store', () => ({
  useSettingsStore: (selector: (s: { globalSettings: { language: string } }) => unknown) =>
    selector({ globalSettings: { language: 'en' } }),
}));

const baseLabels = {
  user: 'User',
  assistant: 'Assistant',
  copy: 'Copy',
  tokens: 'Tokens',
};
const formatNumber = (n: number) => String(n);

const assistantMessageWithSources = (sources: Message['ragSources']): Message => ({
  id: 'msg-1',
  role: 'assistant',
  content: 'Here is an answer grounded in your project.',
  timestamp: Date.now(),
  ragSources: sources,
});

describe('MessageBubble - RAG citations (F11)', () => {
  describe('citation chips', () => {
    it('renders a citation button per source, expand-by-default', () => {
      const message = assistantMessageWithSources([
        { filePath: '/src/a.ts', startLine: 10, endLine: 18, language: 'typescript' },
        { filePath: '/src/b.ts', startLine: 40, endLine: 55 },
      ]);
      render(<MessageBubble message={message} labels={baseLabels} formatNumber={formatNumber} />);

      // Two <button aria-label="open ..."> citation chips should be visible
      // without any extra click (expand-by-default).
      expect(screen.getByRole('button', { name: 'open /src/a.ts 10-18' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'open /src/b.ts 40-55' })).toBeInTheDocument();
    });

    it('does not render any citations when ragSources is null/empty', () => {
      const message: Message = {
        id: 'msg-plain',
        role: 'assistant',
        content: 'a plain answer',
        timestamp: Date.now(),
      };
      render(<MessageBubble message={message} labels={baseLabels} formatNumber={formatNumber} />);

      // The header toggle should be absent when there are 0 sources.
      expect(screen.queryByText('rag.sourceReferenceCount')).toBeNull();
    });

    it('mounts FileChunkViewer in a modal pre-scrolled to the source line range', () => {
      const message = assistantMessageWithSources([
        { filePath: '/src/a.ts', startLine: 10, endLine: 18 },
      ]);
      render(<MessageBubble message={message} labels={baseLabels} formatNumber={formatNumber} />);

      fireEvent.click(screen.getByRole('button', { name: 'open /src/a.ts 10-18' }));
      const dialog = screen.getByRole('dialog', { hidden: true });
      expect(dialog).toBeInTheDocument();
      const viewer = screen.getByTestId('file-chunk-viewer-stub');
      expect(viewer.textContent).toContain('fc:/src/a.ts');
      expect(viewer.textContent).toContain('@10');
    });

    it('closes the citation modal on Escape', () => {
      const message = assistantMessageWithSources([
        { filePath: '/src/a.ts', startLine: 10, endLine: 18 },
      ]);
      render(<MessageBubble message={message} labels={baseLabels} formatNumber={formatNumber} />);

      fireEvent.click(screen.getByRole('button', { name: 'open /src/a.ts 10-18' }));
      expect(screen.getByRole('dialog', { hidden: true })).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    });
  });

  describe('overflow cap', () => {
    const buildManySources = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        filePath: `/src/file-${i}.ts`,
        startLine: 1 + i * 10,
        endLine: 5 + i * 10,
      }));

    it('caps the visible citations at 5 and renders a "Show N more…" affordance', () => {
      const message = assistantMessageWithSources(buildManySources(7));
      render(<MessageBubble message={message} labels={baseLabels} formatNumber={formatNumber} />);

      // Exactly 5 citation chips rendered initially.
      const citationChips = screen
        .getAllByRole('button')
        .filter((btn) => (btn.getAttribute('aria-label') ?? '').startsWith('open '));
      expect(citationChips).toHaveLength(5);

      expect(screen.getByText('Show 2 more…')).toBeInTheDocument();
    });

    it('expands all citations when "Show N more…" is clicked', () => {
      const message = assistantMessageWithSources(buildManySources(7));
      render(<MessageBubble message={message} labels={baseLabels} formatNumber={formatNumber} />);

      fireEvent.click(screen.getByText('Show 2 more…'));

      const citationChips = screen
        .getAllByRole('button')
        .filter((btn) => (btn.getAttribute('aria-label') ?? '').startsWith('open '));
      expect(citationChips).toHaveLength(7);
      // After expanding, a "Show fewer" affordance should appear.
      expect(screen.getByText('a11y.showFewerSources')).toBeInTheDocument();
    });
  });

  describe('collapse affordance', () => {
    it('collapses the section when the section header is clicked', () => {
      const message = assistantMessageWithSources([
        { filePath: '/src/a.ts', startLine: 10, endLine: 18 },
      ]);
      render(<MessageBubble message={message} labels={baseLabels} formatNumber={formatNumber} />);

      // Header button is the sourceReferenceCount label.
      const headerButton = screen.getByText(/rag.sourceReferenceCount/);
      fireEvent.click(headerButton);

      // After collapse, the citation chip should no longer be visible.
      expect(screen.queryByRole('button', { name: 'open /src/a.ts 10-18' })).toBeNull();
    });
  });
});
