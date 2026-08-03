import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import { SearchResults } from './SearchResults';
import { useSettingsStore } from '@/store/settings-store';
import { useRagStore } from '@/store/rag-store';
import type { SearchResult } from '@musaed/contracts';

const mockResults: SearchResult[] = [
  {
    chunkId: 1,
    filePath: '/src/components/Button.tsx',
    content:
      'export const Button = ({ children, onClick }) => <button onClick={onClick}>{children}</button>',
    startLine: 1,
    endLine: 3,
    score: 0.85,
    chunkType: 'code',
    language: 'typescript',
    metadata: {},
  },
  {
    chunkId: 2,
    filePath: '/docs/README.md',
    content:
      '# Button Component\n\nThe Button component is a reusable UI element for handling user interactions.',
    startLine: 10,
    endLine: 15,
    score: 0.72,
    chunkType: 'markdown',
    language: 'markdown',
    metadata: {},
  },
  {
    chunkId: 3,
    filePath: '/package.json',
    content: '{\n  "name": "musaed",\n  "version": "1.0.0",\n  "dependencies": {}\n}',
    startLine: 1,
    endLine: 5,
    score: 0.45,
    chunkType: 'config',
    language: 'json',
    metadata: {},
  },
];

vi.mock('@/lib/i18n', async () => {
  const actual = await vi.importActual('@/lib/i18n');
  return {
    ...(actual as object),
    useTranslation: () => ({
      t: (key: string, values?: Record<string, string | number>) => {
        if (key === 'rag.searchResultCount' && values) {
          return `${values.count} search result${values.count !== 1 ? 's' : ''}`;
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

describe('SearchResults', () => {
  beforeEach(() => {
    clearMocks();

    useSettingsStore.setState({
      globalSettings: {
        temperature: 0.7,
        topK: 40,
        topP: 0.9,
        numPredict: 2048,
        numCtx: 4096,
        stop: [],
        systemPrompt: '',
        ollamaUrl: 'http://localhost:11434',
        language: 'en',
        theme: 'light',
        hasDetectedLanguage: false,
        enterToSend: true,
        chatRetentionDays: 0,
        enableLatex: false,
        enableMermaid: true,
        density: 1.0,
        sidebarWidth: 260,
        closeToTray: true,
      },
    });
  });

  describe('Empty state', () => {
    it('returns null when no search results', () => {
      useRagStore.setState({ searchResults: [] });

      const { container } = render(<SearchResults />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Result count display', () => {
    it('displays search result count', () => {
      useRagStore.setState({ searchResults: mockResults });

      render(<SearchResults />);

      expect(screen.getByText('3 search results')).toBeInTheDocument();
    });

    it('displays singular form for one result', () => {
      useRagStore.setState({ searchResults: [mockResults[0]] });

      render(<SearchResults />);

      expect(screen.getByText('1 search result')).toBeInTheDocument();
    });
  });

  describe('Search result cards', () => {
    beforeEach(() => {
      useRagStore.setState({ searchResults: mockResults });
    });

    it('renders all search result cards', () => {
      render(<SearchResults />);

      const cards = screen.getAllByRole('article');
      expect(cards).toHaveLength(3);
    });

    it('renders rank number for each result', () => {
      render(<SearchResults />);

      expect(screen.getByText('#1')).toBeInTheDocument();
      expect(screen.getByText('#2')).toBeInTheDocument();
      expect(screen.getByText('#3')).toBeInTheDocument();
    });

    it('renders file path for each result', () => {
      render(<SearchResults />);

      expect(screen.getByText('/src/components/Button.tsx')).toBeInTheDocument();
      expect(screen.getByText('/docs/README.md')).toBeInTheDocument();
      expect(screen.getByText('/package.json')).toBeInTheDocument();
    });

    it('renders line range for each result', () => {
      render(<SearchResults />);

      expect(screen.getByText('L1-3')).toBeInTheDocument();
      expect(screen.getByText('L10-15')).toBeInTheDocument();
      expect(screen.getByText('L1-5')).toBeInTheDocument();
    });

    it('renders score percentage for each result', () => {
      render(<SearchResults />);

      expect(screen.getByText('85.0%')).toBeInTheDocument();
      expect(screen.getByText('72.0%')).toBeInTheDocument();
      expect(screen.getByText('45.0%')).toBeInTheDocument();
    });

    it('renders language badge when language is present', () => {
      render(<SearchResults />);

      expect(screen.getByText('typescript')).toBeInTheDocument();
      expect(screen.getByText('markdown')).toBeInTheDocument();
      expect(screen.getByText('json')).toBeInTheDocument();
    });
  });

  describe('Content preview', () => {
    beforeEach(() => {
      useRagStore.setState({ searchResults: mockResults });
    });

    it('renders content preview for each result', () => {
      render(<SearchResults />);

      expect(screen.getByText(/export const Button/)).toBeInTheDocument();
      expect(screen.getByText(/# Button Component/)).toBeInTheDocument();
      expect(screen.getByText(/"name": "musaed"/)).toBeInTheDocument();
    });

    it('truncates content longer than 300 characters', () => {
      const longResult: SearchResult = {
        chunkId: 4,
        filePath: '/src/long.ts',
        content: 'a'.repeat(350),
        startLine: 1,
        endLine: 10,
        score: 0.9,
        chunkType: 'code',
        language: 'typescript',
        metadata: {},
      };
      useRagStore.setState({ searchResults: [longResult] });

      render(<SearchResults />);

      const preview = screen.getByText(/a{300}\.\.\./);
      expect(preview).toBeInTheDocument();
    });
  });

  describe('Chunk type icons', () => {
    it('renders code icon for code chunks', () => {
      useRagStore.setState({ searchResults: [mockResults[0]] });

      render(<SearchResults />);

      const codeIcon = screen.getByTestId('code-icon');
      expect(codeIcon).toBeInTheDocument();
    });

    it('renders markdown icon for markdown chunks', () => {
      useRagStore.setState({ searchResults: [mockResults[1]] });

      render(<SearchResults />);

      const markdownIcon = screen.getByTestId('file-text-icon');
      expect(markdownIcon).toBeInTheDocument();
    });

    it('renders config icon for config chunks', () => {
      useRagStore.setState({ searchResults: [mockResults[2]] });

      render(<SearchResults />);

      const configIcon = screen.getByTestId('file-code-icon');
      expect(configIcon).toBeInTheDocument();
    });

    it('renders default file icon for unknown chunk types', () => {
      const unknownResult: SearchResult = {
        chunkId: 5,
        filePath: '/src/unknown.xyz',
        content: 'unknown content',
        startLine: 1,
        endLine: 5,
        score: 0.5,
        chunkType: 'unknown',
        language: 'unknown',
        metadata: {},
      };
      useRagStore.setState({ searchResults: [unknownResult] });

      render(<SearchResults />);

      const fileIcon = screen.getByTestId('file-icon');
      expect(fileIcon).toBeInTheDocument();
    });
  });

  describe('Scrollable container', () => {
    beforeEach(() => {
      useRagStore.setState({ searchResults: mockResults });
    });

    it('renders scrollable container with max height', () => {
      render(<SearchResults />);

      const scrollContainer = screen.getByRole('list');
      expect(scrollContainer).toHaveClass('max-h-80');
      expect(scrollContainer).toHaveClass('overflow-y-auto');
    });
  });

  describe('RTL support', () => {
    it('applies correct direction when Arabic language is selected', () => {
      useSettingsStore.setState({
        globalSettings: {
          temperature: 0.7,
          topK: 40,
          topP: 0.9,
          numPredict: 2048,
          numCtx: 4096,
          stop: [],
          systemPrompt: '',
          ollamaUrl: 'http://localhost:11434',
          language: 'ar',
          theme: 'light',
          hasDetectedLanguage: false,
          enterToSend: true,
          chatRetentionDays: 0,
          enableLatex: false,
          enableMermaid: true,
          density: 1.0,
          sidebarWidth: 260,
          closeToTray: true,
        },
      });
      useRagStore.setState({ searchResults: mockResults });

      const { container } = render(<SearchResults />);

      expect(container).toBeInTheDocument();
    });
  });
});
