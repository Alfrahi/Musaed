// Tests for SearchModal — keyboard navigation, ARIA semantics, result rendering.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// jsdom doesn't implement Element.scrollIntoView — mock it.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// ── Mock useMessageSearch hook ────────────────────────────────────────────
const useMessageSearchMock = vi.hoisted(() => ({
  query: '',
  setQuery: vi.fn(),
  results: [] as Array<Record<string, unknown>>,
  isSearching: false,
  error: null as string | null,
}));

vi.mock('../hooks/useMessageSearch', () => ({
  useMessageSearch: () => useMessageSearchMock,
}));

// ── Mock IPC / i18n / stores ───────────────────────────────────────────────
vi.mock('@/lib/ipc', () => ({
  conversationApi: { searchMessages: vi.fn() },
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    formatNumber: (n: number) => String(n),
    formatDate: (d: number | Date) => String(d),
    isRtl: false,
    formatFileSize: (b: number) => `${b} B`,
  }),
}));

// Construct a minimal mock that returns the single selector used by SearchModal:
// `useSettingsStore((s) => s.globalSettings.language)` → 'en'.
// Also export `useSetCurrentConversationId` from `@/store/conversation-store`.
vi.mock('@/store', () => ({
  useSettingsStore: (sel: (s: { globalSettings: { language: string } }) => string) =>
    sel({ globalSettings: { language: 'en' } }),
}));

const setCurrentConversationIdMock = vi.fn();
vi.mock('@/store/conversation-store', () => ({
  useSetCurrentConversationId: () => setCurrentConversationIdMock,
}));

// ── Import after mocks are hoisted ─────────────────────────────────────────
import SearchModal from './SearchModal';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset mock state between tests
  useMessageSearchMock.query = '';
  useMessageSearchMock.setQuery = vi.fn((q: string) => {
    useMessageSearchMock.query = q;
  });
  useMessageSearchMock.results = [];
  useMessageSearchMock.isSearching = false;
  useMessageSearchMock.error = null;
});

// Factory for a single search result.
function makeResult(
  conversationId: string,
  conversationTitle: string,
  messageId: string,
  content: string,
  role: 'user' | 'assistant' = 'assistant'
) {
  return {
    message: {
      id: messageId,
      role,
      content,
      timestamp: 1700000000000,
      model: 'test-model',
      done: true,
      requestId: 'req-1',
      images: undefined,
      evalCount: 0,
      promptEvalCount: 0,
      totalDuration: 0,
      evalDuration: 0,
      ragSources: undefined,
      error: undefined,
    },
    conversationId,
    conversationTitle,
  };
}

describe('SearchModal', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<SearchModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog with translated title when open', () => {
    render(<SearchModal isOpen onClose={vi.fn()} />);
    expect(screen.getByText('search.title')).toBeInTheDocument();
  });

  it('shows the search input with placeholder', () => {
    render(<SearchModal isOpen onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('search.placeholder')).toBeInTheDocument();
  });

  it('renders startTyping prompt before any query is entered', () => {
    render(<SearchModal isOpen onClose={vi.fn()} />);
    expect(screen.getByText('search.startTyping')).toBeInTheDocument();
  });

  it('renders the loading spinner when isSearching', () => {
    useMessageSearchMock.isSearching = true;
    render(<SearchModal isOpen onClose={vi.fn()} />);
    // The spinner has an aria-hidden SVG with the animate-spin class.
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
  });

  it('renders results with role badge and conversation title when results exist', async () => {
    useMessageSearchMock.query = 'test';
    useMessageSearchMock.results = [
      makeResult('c1', 'My Conversation', 'm1', 'hello test world', 'user'),
      makeResult('c2', 'Other Chat', 'm2', 'assistant test response', 'assistant'),
    ];

    render(<SearchModal isOpen onClose={vi.fn()} />);

    expect(screen.getByText('My Conversation')).toBeInTheDocument();
    expect(screen.getByText('Other Chat')).toBeInTheDocument();
    expect(screen.getByText('search.roleUser')).toBeInTheDocument();
    expect(screen.getByText('search.roleAssistant')).toBeInTheDocument();
    expect(screen.getByText(/hello test world/)).toBeInTheDocument();
    expect(screen.getByText(/assistant test response/)).toBeInTheDocument();
  });

  it('renders the "no results" message when query yields nothing', () => {
    useMessageSearchMock.query = 'nonexistent';
    useMessageSearchMock.results = [];

    render(<SearchModal isOpen onClose={vi.fn()} />);
    expect(screen.getByText('search.noResults')).toBeInTheDocument();
  });

  it('renders an error message when error is set', () => {
    useMessageSearchMock.query = 'fail';
    useMessageSearchMock.error = 'Backend error';

    render(<SearchModal isOpen onClose={vi.fn()} />);
    expect(screen.getByText('Backend error')).toBeInTheDocument();
  });

  it('calls setQuery on input change with the new value', () => {
    render(<SearchModal isOpen onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('search.placeholder');
    fireEvent.change(input, { target: { value: 'hello' } });
    expect(useMessageSearchMock.setQuery).toHaveBeenCalledWith('hello');
  });

  it('calls onClose when Escape is pressed inside the modal', async () => {
    const onClose = vi.fn();
    render(<SearchModal isOpen onClose={onClose} />);
    // ModalLayout renders a backdrop; pressing Escape closes it.
    const dialog = screen.getByRole('dialog', { hidden: true });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  describe('keyboard navigation', () => {
    function withResults() {
      useMessageSearchMock.query = 'test';
      useMessageSearchMock.results = [
        makeResult('c1', 'Conv 1', 'm1', 'first test'),
        makeResult('c2', 'Conv 2', 'm2', 'second test'),
        makeResult('c3', 'Conv 3', 'm3', 'third test'),
      ];
    }

    it('navigates with ArrowDown and ArrowUp', () => {
      withResults();
      render(<SearchModal isOpen onClose={vi.fn()} />);
      const input = screen.getByPlaceholderText('search.placeholder');

      // Initially no active item (activeIndex=0 means index 0 is active, but
      // only after the first ArrowDown does the user explicitly select).
      // The listbox has three options; keyboard nav starts at index 0.
      // Verify ArrowDown moves the active selection forward.
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(screen.getByRole('option', { name: /second test/ })).toHaveAttribute(
        'aria-selected',
        'true'
      );

      // ArrowDown again — moves to index 2
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(screen.getByRole('option', { name: /third test/ })).toHaveAttribute(
        'aria-selected',
        'true'
      );

      // ArrowUp — back to index 1
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(screen.getByRole('option', { name: /second test/ })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      // Previous item no longer active
      expect(screen.getByRole('option', { name: /third test/ })).toHaveAttribute(
        'aria-selected',
        'false'
      );
    });

    it('clamps ArrowUp at index 0', () => {
      withResults();
      render(<SearchModal isOpen onClose={vi.fn()} />);
      const input = screen.getByPlaceholderText('search.placeholder');

      // ArrowDown — first item active
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      // ArrowUp — should stay at 0
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(screen.getByRole('option', { name: /first test/ })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });

    it('clamps ArrowDown at last index', () => {
      withResults();
      render(<SearchModal isOpen onClose={vi.fn()} />);
      const input = screen.getByPlaceholderText('search.placeholder');

      // Move down multiple times to reach the last item (index 2)
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      // One more — should stay at last item
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(screen.getByRole('option', { name: /third test/ })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });

    it('sets conversation and calls onClose on Enter when an item is active', () => {
      withResults();
      const onClose = vi.fn();
      render(<SearchModal isOpen onClose={onClose} />);
      const input = screen.getByPlaceholderText('search.placeholder');

      // Activate index 1 (c2) with a single ArrowDown (activeIndex starts at 0)
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      // Press Enter
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(setCurrentConversationIdMock).toHaveBeenCalledWith('c2');
      expect(onClose).toHaveBeenCalled();
    });

    it('clicking a result calls setCurrentConversationId and onClose', () => {
      withResults();
      const onClose = vi.fn();
      render(<SearchModal isOpen onClose={onClose} />);

      const item = screen.getByRole('option', { name: /second test/ });
      fireEvent.click(item);

      expect(setCurrentConversationIdMock).toHaveBeenCalledWith('c2');
      expect(onClose).toHaveBeenCalled();
    });
  });
});
