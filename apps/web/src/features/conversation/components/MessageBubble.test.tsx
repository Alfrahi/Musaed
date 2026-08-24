import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { Message } from '@musaed/contracts';
import MessageBubble from './MessageBubble';
import { dialogApi } from '@/lib/ipc';

// Shared spy for useMessageActions.handleCopy so tests can assert what the
// copy path received (selection override vs. undefined full-message copy).
const { mockHandleCopy } = vi.hoisted(() => ({ mockHandleCopy: vi.fn() }));

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

// framer-motion is mocked so the entrance animation is a no-op in tests
// (motion.div renders as a plain div, preserving role/aria/query semantics).
vi.mock('framer-motion', () => ({
  motion: { div: 'div' },
  useReducedMotion: () => false,
}));

vi.mock('@/features/conversation/hooks/useMessageActions', () => ({
  useMessageActions: () => ({ copied: false, handleCopy: mockHandleCopy, tps: null }),
}));

vi.mock('@/lib/ipc', () => ({
  dialogApi: {
    ask: vi.fn().mockResolvedValue(true),
  },
  contextMenuApi: {
    show: vi.fn().mockResolvedValue({ selectedItem: 'copy' }),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
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
        if (key === 'chat.userUploadedImage') {
          return 'User uploaded image';
        }
        if (key === 'chat.userUploadedImageIndexed' && values) {
          return `User uploaded image ${values.index} of ${values.total}`;
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
  outputTokens: 'Output',
  promptTokens: 'Prompt',
  totalTokens: 'Total',
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

describe('MessageBubble - stopped status line', () => {
  const stoppedMessage: Message = {
    id: 'msg-stopped',
    role: 'assistant',
    content: 'Partial response...',
    timestamp: Date.now(),
    stopped: true,
  };

  it('renders "Stopped by user • Continue" when stopped is true', () => {
    const onContinue = vi.fn();
    render(
      <MessageBubble
        message={stoppedMessage}
        labels={baseLabels}
        formatNumber={formatNumber}
        onContinue={onContinue}
      />
    );

    expect(screen.getByText('chat.stoppedByUser')).toBeInTheDocument();
    expect(screen.getByText('chat.continue')).toBeInTheDocument();
  });

  it('calls onContinue with the message id when the Continue button is clicked', () => {
    const onContinue = vi.fn();
    render(
      <MessageBubble
        message={stoppedMessage}
        labels={baseLabels}
        formatNumber={formatNumber}
        onContinue={onContinue}
      />
    );

    fireEvent.click(screen.getByText('chat.continue'));
    expect(onContinue).toHaveBeenCalledWith('msg-stopped');
  });

  it('does not render stopped line when stopped is not true', () => {
    const normalMessage: Message = {
      id: 'msg-normal',
      role: 'assistant',
      content: 'Complete response',
      timestamp: Date.now(),
    };
    render(
      <MessageBubble message={normalMessage} labels={baseLabels} formatNumber={formatNumber} />
    );

    expect(screen.queryByText('chat.stoppedByUser')).toBeNull();
  });

  it('does not render stopped line for user messages even if stopped is true', () => {
    const userMsg: Message = {
      id: 'msg-user',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
      stopped: true,
    };
    render(<MessageBubble message={userMsg} labels={baseLabels} formatNumber={formatNumber} />);

    expect(screen.queryByText('chat.stoppedByUser')).toBeNull();
  });
});

describe('MessageBubble - hover actions', () => {
  it('renders Regenerate button on assistant messages when onRegenerate is provided', () => {
    const onRegenerate = vi.fn();
    const message: Message = {
      id: 'msg-1',
      role: 'assistant',
      content: 'Response',
      timestamp: Date.now(),
    };
    render(
      <MessageBubble
        message={message}
        labels={baseLabels}
        formatNumber={formatNumber}
        onRegenerate={onRegenerate}
      />
    );

    const btn = screen.getByRole('button', { name: 'chat.regenerate' });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onRegenerate).toHaveBeenCalledWith('msg-1');
  });

  it('renders inline editor on user messages when onEditMessage is provided', () => {
    const onEditMessage = vi.fn();
    const message: Message = {
      id: 'msg-1',
      role: 'user',
      content: 'My question',
      timestamp: Date.now(),
    };
    render(
      <MessageBubble
        message={message}
        labels={baseLabels}
        formatNumber={formatNumber}
        onEditMessage={onEditMessage}
      />
    );

    // Click the Edit button to enter inline edit mode.
    const editBtn = screen.getByRole('button', { name: 'chat.editPrompt' });
    fireEvent.click(editBtn);

    // A textarea should appear pre-populated with the original content.
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue('My question');

    // Modify the content and save.
    fireEvent.change(textarea, { target: { value: 'Edited question' } });
    const saveBtn = screen.getByRole('button', { name: 'common.save' });
    fireEvent.click(saveBtn);

    expect(onEditMessage).toHaveBeenCalledWith('msg-1', 'Edited question');
  });

  it('cancels inline edit without calling onEditMessage', () => {
    const onEditMessage = vi.fn();
    const message: Message = {
      id: 'msg-1',
      role: 'user',
      content: 'My question',
      timestamp: Date.now(),
    };
    render(
      <MessageBubble
        message={message}
        labels={baseLabels}
        formatNumber={formatNumber}
        onEditMessage={onEditMessage}
      />
    );

    const editBtn = screen.getByRole('button', { name: 'chat.editPrompt' });
    fireEvent.click(editBtn);

    const cancelBtn = screen.getByRole('button', { name: 'common.cancel' });
    fireEvent.click(cancelBtn);

    expect(onEditMessage).not.toHaveBeenCalled();
    // After cancel, the textarea should be gone and original content visible.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('does not render hover actions when no callbacks are provided', () => {
    const message: Message = {
      id: 'msg-1',
      role: 'assistant',
      content: 'Response',
      timestamp: Date.now(),
    };
    render(<MessageBubble message={message} labels={baseLabels} formatNumber={formatNumber} />);

    expect(screen.queryByRole('button', { name: 'chat.regenerate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'chat.editPrompt' })).not.toBeInTheDocument();
  });
});

describe('MessageBubble - image alt text (UX-007)', () => {
  const singleImageMessage: Message = {
    id: 'msg-img-1',
    role: 'user',
    content: 'What is this?',
    timestamp: Date.now(),
    images: ['data:image/png;base64,iVBORw0KGgo='],
  };

  const multiImageMessage: Message = {
    id: 'msg-img-multi',
    role: 'user',
    content: 'Compare these',
    timestamp: Date.now(),
    images: [
      'data:image/png;base64,iVBORw0KGgoAAA==',
      'data:image/png;base64,iVBORw0KGgoBBB==',
      'data:image/png;base64,iVBORw0KGgoCCC==',
    ],
  };

  it('renders meaningful alt text for a single user uploaded image', () => {
    render(
      <MessageBubble message={singleImageMessage} labels={baseLabels} formatNumber={formatNumber} />
    );

    const img = screen.getByAltText('User uploaded image');
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe('IMG');
  });

  it('renders indexed alt text when multiple images are attached', () => {
    render(
      <MessageBubble message={multiImageMessage} labels={baseLabels} formatNumber={formatNumber} />
    );

    expect(screen.getByAltText('User uploaded image 1 of 3')).toBeInTheDocument();
    expect(screen.getByAltText('User uploaded image 2 of 3')).toBeInTheDocument();
    expect(screen.getByAltText('User uploaded image 3 of 3')).toBeInTheDocument();
  });

  it('does not render any images when message has no images', () => {
    const message: Message = {
      id: 'msg-noimg',
      role: 'user',
      content: 'just text',
      timestamp: Date.now(),
    };
    render(<MessageBubble message={message} labels={baseLabels} formatNumber={formatNumber} />);

    expect(screen.queryByAltText('User uploaded image')).not.toBeInTheDocument();
  });

  it('does not render empty alt text', () => {
    render(
      <MessageBubble message={singleImageMessage} labels={baseLabels} formatNumber={formatNumber} />
    );

    const images = screen.getAllByRole('img');
    for (const img of images) {
      expect(img.getAttribute('alt')).not.toBe('');
    }
  });
});

describe('MessageBubble - delete action', () => {
  afterEach(() => {
    vi.mocked(dialogApi.ask).mockReset();
  });

  it('renders a delete button when onDeleteMessage is provided', () => {
    const onDeleteMessage = vi.fn();
    const message: Message = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    };
    render(
      <MessageBubble
        message={message}
        labels={baseLabels}
        formatNumber={formatNumber}
        onDeleteMessage={onDeleteMessage}
      />
    );

    expect(screen.getByRole('button', { name: 'common.delete' })).toBeInTheDocument();
  });

  it('does not render a delete button when onDeleteMessage is not provided', () => {
    const message: Message = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    };
    render(<MessageBubble message={message} labels={baseLabels} formatNumber={formatNumber} />);

    expect(screen.queryByRole('button', { name: 'common.delete' })).not.toBeInTheDocument();
  });

  it('shows confirmation dialog and calls onDeleteMessage when confirmed', async () => {
    vi.mocked(dialogApi.ask).mockResolvedValue(true);
    const onDeleteMessage = vi.fn();
    const message: Message = {
      id: 'msg-del-1',
      role: 'assistant',
      content: 'Response',
      timestamp: Date.now(),
    };
    render(
      <MessageBubble
        message={message}
        labels={baseLabels}
        formatNumber={formatNumber}
        onDeleteMessage={onDeleteMessage}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));

    await vi.waitFor(() => {
      expect(dialogApi.ask).toHaveBeenCalledWith(
        'chat.deleteMessage',
        'chat.confirmDeleteMessage',
        'warning'
      );
    });
    await vi.waitFor(() => {
      expect(onDeleteMessage).toHaveBeenCalledWith('msg-del-1');
    });
  });

  it('does not call onDeleteMessage when confirmation is cancelled', async () => {
    vi.mocked(dialogApi.ask).mockResolvedValue(false);
    const onDeleteMessage = vi.fn();
    const message: Message = {
      id: 'msg-del-2',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    };
    render(
      <MessageBubble
        message={message}
        labels={baseLabels}
        formatNumber={formatNumber}
        onDeleteMessage={onDeleteMessage}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));

    await vi.waitFor(() => {
      expect(dialogApi.ask).toHaveBeenCalled();
    });
    expect(onDeleteMessage).not.toHaveBeenCalled();
  });
});

describe('MessageBubble - context menu copy', () => {
  const copyableMessage: Message = {
    id: 'msg-copy',
    role: 'assistant',
    content: 'selectable sentence',
    timestamp: Date.now(),
  };

  const renderCopyable = () =>
    render(
      <MessageBubble message={copyableMessage} labels={baseLabels} formatNumber={formatNumber} />
    );

  beforeEach(() => {
    mockHandleCopy.mockClear();
    window.getSelection()?.removeAllRanges();
  });

  it('copies only the selected text when Copy is chosen from the context menu', async () => {
    renderCopyable();

    const textEl = screen.getByText('selectable sentence');
    const range = document.createRange();
    range.selectNodeContents(textEl);
    window.getSelection()?.addRange(range);

    fireEvent.contextMenu(textEl);

    await waitFor(() => {
      expect(mockHandleCopy).toHaveBeenCalledWith('selectable sentence');
    });
  });

  it('falls back to whole-message copy (no override) when nothing is selected', async () => {
    renderCopyable();

    fireEvent.contextMenu(screen.getByText('selectable sentence'));

    await waitFor(() => {
      expect(mockHandleCopy).toHaveBeenCalledWith(undefined);
    });
  });

  it('ignores selections outside the bubble and copies the whole message', async () => {
    renderCopyable();

    // Select unrelated text outside the bubble (document body)…
    const range = document.createRange();
    range.selectNodeContents(document.body);
    window.getSelection()?.addRange(range);

    fireEvent.contextMenu(screen.getByText('selectable sentence'));

    await waitFor(() => {
      expect(mockHandleCopy).toHaveBeenCalledWith(undefined);
    });
  });
});
