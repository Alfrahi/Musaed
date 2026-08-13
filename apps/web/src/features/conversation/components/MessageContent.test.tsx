import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Message } from '@musaed/contracts';
import MessageContent from './MessageContent';

// MarkdownRenderer is dynamically imported; mock it synchronously so tests
// can assert whether it was consulted for the streaming vs done path.
const { MarkdownRendererStub } = vi.hoisted(() => ({
  MarkdownRendererStub: vi.fn(({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  )),
}));

vi.mock('next/dynamic', () => ({
  default: () => MarkdownRendererStub,
}));

// ThinkingBlock reads language + translation; stub the i18n surface so
// test assertions match by raw key.
vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    formatNumber: (n: number) => String(n),
    formatDate: (d: number | Date) => String(d),
    isRtl: false,
    formatFileSize: (b: number) => `${b} B`,
  }),
}));

// ThinkingBlock pulls language from settings store; stub minimal shape.
vi.mock('@/store', () => ({
  useSettingsStore: () => ({ language: 'en' }),
}));

const baseMessage: Message = {
  id: 'msg-1',
  role: 'assistant',
  content: '',
  timestamp: Date.now(),
  done: true,
};

describe('MessageContent', () => {
  afterEach(() => {
    MarkdownRendererStub.mockClear();
  });

  describe('assistant streaming (done = false)', () => {
    it('renders raw text instead of MarkdownRenderer when not done', () => {
      const message: Message = {
        ...baseMessage,
        content: 'Some **bold** and `code` text',
        done: false,
      };

      render(<MessageContent message={message} isUser={false} />);

      expect(screen.getByText('Some **bold** and `code` text')).toBeTruthy();
      expect(MarkdownRendererStub).not.toHaveBeenCalled();
    });

    it('preserves whitespace via whitespace-pre-wrap', () => {
      const message: Message = {
        ...baseMessage,
        content: 'line one\nline two\n\nline four',
        done: false,
      };

      const { container } = render(<MessageContent message={message} isUser={false} />);

      const textContainer = container.querySelector('.whitespace-pre-wrap');
      expect(textContainer).toBeTruthy();
      expect(textContainer?.textContent).toBe('line one\nline two\n\nline four');
    });

    it('marks the container as aria-busy while streaming', () => {
      const message: Message = {
        ...baseMessage,
        content: 'partial response',
        done: false,
      };

      render(<MessageContent message={message} isUser={false} />);

      expect(
        screen.getByText('partial response').closest('[aria-busy]')?.getAttribute('aria-busy')
      ).toBe('true');
    });

    it('shows loading dots when streaming with no content and no thinking block', () => {
      const message: Message = {
        ...baseMessage,
        content: '',
        done: false,
      };

      const { container } = render(<MessageContent message={message} isUser={false} />);

      const dots = container.querySelectorAll('.animate-bounce');
      expect(dots).toHaveLength(3);
      expect(MarkdownRendererStub).not.toHaveBeenCalled();
    });

    it('renders thinking block live while streaming (no closing tag)', () => {
      const message: Message = {
        ...baseMessage,
        content: '<reasoning>reasoning in progress',
        done: false,
      };

      render(<MessageContent message={message} isUser={false} />);

      expect(screen.getByRole('region')).toBeTruthy();
      expect(screen.getByText('chat.thinking')).toBeTruthy();
      expect(MarkdownRendererStub).not.toHaveBeenCalled();
    });

    it('renders main content as plain text alongside finished thinking block', () => {
      const message: Message = {
        ...baseMessage,
        content: '<reasoning>reasoning complete</reasoning>answer text arriving',
        done: false,
      };

      render(<MessageContent message={message} isUser={false} />);

      expect(screen.getByText('answer text arriving')).toBeTruthy();
      expect(MarkdownRendererStub).not.toHaveBeenCalled();
    });
  });

  describe('assistant done (done = true)', () => {
    it('renders through MarkdownRenderer when done', () => {
      const message: Message = {
        ...baseMessage,
        content: '# Heading\n\nSome **bold** text',
        done: true,
      };

      render(<MessageContent message={message} isUser={false} />);

      expect(MarkdownRendererStub).toHaveBeenCalledTimes(1);
      expect(MarkdownRendererStub).toHaveBeenCalledWith(
        { content: '# Heading\n\nSome **bold** text' },
        undefined
      );
    });

    it('marks the container as not aria-busy when done', () => {
      const message: Message = {
        ...baseMessage,
        content: 'finished response',
        done: true,
      };

      const { container } = render(<MessageContent message={message} isUser={false} />);

      expect(container.querySelector('[aria-busy="false"]')).toBeTruthy();
    });

    it('renders thinking block collapsed when thinking is finished and main content exists', () => {
      const message: Message = {
        ...baseMessage,
        content: '<reasoning>thoughts</reasoning>Final answer here',
        done: true,
      };

      render(<MessageContent message={message} isUser={false} />);

      expect(MarkdownRendererStub).toHaveBeenCalledTimes(1);
      expect(MarkdownRendererStub).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Final answer here') }),
        undefined
      );
      expect(screen.queryByText('chat.thinking')).toBeNull();
    });
  });

  describe('user messages', () => {
    it('always renders through MarkdownRenderer (never streaming)', () => {
      const message: Message = {
        ...baseMessage,
        role: 'user',
        content: 'Hello *world*',
        done: false,
      };

      render(<MessageContent message={message} isUser={true} />);

      expect(MarkdownRendererStub).toHaveBeenCalledTimes(1);
      expect(MarkdownRendererStub).toHaveBeenCalledWith({ content: 'Hello *world*' }, undefined);
    });

    it('does not render a thinking block or markdown content for empty user messages', () => {
      const message: Message = {
        ...baseMessage,
        role: 'user',
        content: '',
        done: true,
      };

      render(<MessageContent message={message} isUser={true} />);

      expect(screen.queryByRole('region')).toBeNull();
      expect(MarkdownRendererStub).not.toHaveBeenCalled();
    });
  });
});
