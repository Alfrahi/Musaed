import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ConversationItem from './ConversationItem';
import type { ConversationMetadata } from '@/store/conversation-store';

// Mutable hook state so each test can drive isActive (current-conversation id)
// and the setCurrentConversation callback independently.
let mockCurrentId: string | null = null;
const mockSetCurrentConversationId = vi.fn();
const mockHandleDeleteConversation = vi.fn();
const mockHandleRenameConversation = vi.fn();
const mockHandleExport = vi.fn();

// framer-motion is mocked so the entrance animation is a no-op in tests
// (motion.div renders as a plain div, preserving role/aria/tabIndex queries).
vi.mock('framer-motion', () => ({
  motion: { div: 'div' },
  useReducedMotion: () => false,
}));

vi.mock('@/lib/i18n', async () => {
  const actual = await vi.importActual('@/lib/i18n');
  return {
    ...(actual as object),
    useTranslation: () => ({
      t: (key: string) => key,
      formatNumber: (num: number) => num.toString(),
      formatDate: (date: number | Date) => String(date),
      isRtl: false,
      formatFileSize: (bytes: number) => `${bytes} B`,
    }),
  };
});

vi.mock('@/store', () => ({
  useLanguage: () => 'en',
}));

vi.mock('@/store/conversation-store', () => ({
  useCurrentConversationId: () => mockCurrentId,
  useSetCurrentConversationId: () => mockSetCurrentConversationId,
}));

vi.mock('@/features/sidebar/hooks/useSidebarActions', () => ({
  useSidebarActions: () => ({
    handleDeleteConversation: mockHandleDeleteConversation,
    handleRenameConversation: mockHandleRenameConversation,
    handleExport: mockHandleExport,
  }),
}));

const baseConversation: ConversationMetadata = {
  id: 'conv-1',
  title: 'Hello world',
  model: 'test-model',
  settings: {
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
    sidebarCollapsed: false,
    closeToTray: true,
    showTokenIndicator: true,
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe('ConversationItem', () => {
  beforeEach(() => {
    mockCurrentId = null;
    mockSetCurrentConversationId.mockClear();
    mockHandleDeleteConversation.mockClear();
    mockHandleRenameConversation.mockClear();
    mockHandleExport.mockClear();
  });

  describe('ARIA listbox option semantics', () => {
    it('renders a div with role="option" and a stable id', () => {
      render(<ConversationItem conversation={baseConversation} />);
      const option = screen.getByRole('option');
      expect(option).toHaveAttribute('id', 'conversation-option-conv-1');
    });

    it('sets tabIndex=0 when active and tabIndex=-1 when not (roving tabindex)', () => {
      const { rerender } = render(<ConversationItem conversation={baseConversation} />);
      // inactive
      expect(screen.getByRole('option')).toHaveAttribute('tabindex', '-1');

      mockCurrentId = 'conv-1';
      rerender(<ConversationItem conversation={baseConversation} />);
      expect(screen.getByRole('option')).toHaveAttribute('tabindex', '0');
    });

    it('sets aria-current="page" and aria-selected="true" only when active', () => {
      const { rerender } = render(<ConversationItem conversation={baseConversation} />);
      const option = screen.getByRole('option');
      expect(option).not.toHaveAttribute('aria-current');
      expect(option).not.toHaveAttribute('aria-selected');

      mockCurrentId = 'conv-1';
      rerender(<ConversationItem conversation={baseConversation} />);
      expect(option).toHaveAttribute('aria-current', 'page');
      expect(option).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('Activation', () => {
    it('clicking the row calls setCurrentConversationId', () => {
      render(<ConversationItem conversation={baseConversation} />);
      fireEvent.click(screen.getByRole('option'));
      expect(mockSetCurrentConversationId).toHaveBeenCalledTimes(1);
      expect(mockSetCurrentConversationId).toHaveBeenCalledWith('conv-1');
    });

    it('Enter activates the row', () => {
      render(<ConversationItem conversation={baseConversation} />);
      const option = screen.getByRole('option');
      fireEvent.keyDown(option, { key: 'Enter' });
      expect(mockSetCurrentConversationId).toHaveBeenCalledWith('conv-1');
    });

    it('Space activates the row', () => {
      render(<ConversationItem conversation={baseConversation} />);
      const option = screen.getByRole('option');
      fireEvent.keyDown(option, { key: ' ' });
      expect(mockSetCurrentConversationId).toHaveBeenCalledWith('conv-1');
    });

    it('Enter does not double-activate while editing (rename input open)', () => {
      // Activate rename via the edit button.
      render(<ConversationItem conversation={baseConversation} />);
      const editButton = screen.getByTitle('sidebar.renameChat');
      fireEvent.click(editButton);
      // The rename <input> is now mounted.
      const input = screen.getByDisplayValue('Hello world');
      // Row-level Enter while editing must not call setCurrentConversationId —
      // the inline form's onSubmit handles commit.
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(mockSetCurrentConversationId).not.toHaveBeenCalled();
    });
  });

  describe('Focus-visible ring (WCAG 2.4.7 Focus Visible)', () => {
    it('applies the focus-ring utility so keyboard focus is visually distinct from the active state', () => {
      // The active row uses border-primary + bg-zinc-200/50. Without a
      // focus-visible ring, a keyboard user cannot tell which row is focused
      // vs. merely active. The `.focus-ring` utility (globals.css) applies
      // `focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2`
      // — only on keyboard navigation, not programmatic .focus(), so the
      // launch-focus flash stays suppressed.
      render(<ConversationItem conversation={baseConversation} />);
      const option = screen.getByRole('option');
      expect(option.className).toMatch(/\bfocus-ring\b/);
    });

    it('does not apply a blanket outline-none that would suppress all focus indicators', () => {
      render(<ConversationItem conversation={baseConversation} />);
      const option = screen.getByRole('option');
      // outline-none without the focus-visible: prefix was the old bug — it
      // removed focus styling entirely. focus-ring uses focus-visible:outline-none.
      expect(option.className).not.toMatch(/(^|\s)outline-none(\s|$)/);
    });

    it('does not programmatically focus the row on initial mount when already active', () => {
      // On app launch the first conversation is active. The old code called
      // rowRef.focus() in a useEffect, which browsers classify as
      // :focus-visible when there's no prior user interaction — flashing the
      // ring before the user touches the keyboard. The fix skips the
      // programmatic .focus() when the row is active on its initial mount.
      mockCurrentId = 'conv-1';
      render(<ConversationItem conversation={baseConversation} />);
      const option = screen.getByRole('option');
      expect(option).not.toHaveFocus();
    });

    it('programmatically focuses the row when a different conversation becomes active', () => {
      // Roving tabindex: when the active conversation changes to this row
      // (not on initial mount), it should receive programmatic focus so
      // keyboard users land on it when Tabbing into the listbox.
      mockCurrentId = 'other-conv';
      const { rerender } = render(<ConversationItem conversation={baseConversation} />);
      // Not active yet — no focus.
      expect(screen.getByRole('option')).not.toHaveFocus();

      // Now this conversation becomes active — should be focused.
      mockCurrentId = 'conv-1';
      rerender(<ConversationItem conversation={baseConversation} />);
      expect(screen.getByRole('option')).toHaveFocus();
    });
  });

  describe('Title/action overlap prevention', () => {
    it('reserves inline-end padding on the title so action buttons do not overlap text', () => {
      render(<ConversationItem conversation={baseConversation} />);
      const title = screen.getByText('Hello world');
      expect(title.className).toMatch(/\bpe-14\b/);
    });
  });

  describe('Hover-only action buttons reachable on focus (Phase 2 item 21)', () => {
    it('renders edit action buttons and they remain in the DOM when row is focused', () => {
      render(<ConversationItem conversation={baseConversation} />);
      // The three action buttons exist with their tooltip titles; visual opacity
      // is CSS-gated on group-hover/group-focus-within, but they're in the a11y
      // tree and individually focusable.
      expect(screen.getByTitle('sidebar.renameChat')).toBeInTheDocument();
      expect(screen.getByTitle('sidebar.exportMarkdown')).toBeInTheDocument();
      expect(screen.getByTitle('sidebar.deleteChat')).toBeInTheDocument();
    });

    it('delete action button calls handleDeleteConversation with the conversation id', () => {
      render(<ConversationItem conversation={baseConversation} />);
      fireEvent.click(screen.getByTitle('sidebar.deleteChat'));
      expect(mockHandleDeleteConversation).toHaveBeenCalledWith('conv-1');
    });

    it('action buttons have 24×24 px minimum tap targets (WCAG 2.5.5)', () => {
      render(<ConversationItem conversation={baseConversation} />);
      const edit = screen.getByTitle('sidebar.renameChat');
      const exportBtn = screen.getByTitle('sidebar.exportMarkdown');
      const del = screen.getByTitle('sidebar.deleteChat');
      for (const btn of [edit, exportBtn, del]) {
        expect(btn.className).toMatch(/\bmin-w-6\b/);
        expect(btn.className).toMatch(/\bmin-h-6\b/);
      }
    });
  });
});
