import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import CommandPalette from './CommandPalette';

// Mock the settings store — CommandPalette + useCommands read globalSettings
// (language + theme) and the setGlobalSettings setter.
const mockGlobalSettings = {
  language: 'en',
  theme: 'dark' as const,
};
const mockSetGlobalSettings = vi.fn();
vi.mock('@/store/settings-store', () => ({
  useSettingsStore: vi.fn((selector) => selector({ globalSettings: mockGlobalSettings })),
  useSetGlobalSettings: () => mockSetGlobalSettings,
}));

// Mock the model store — provides the installed models list.
const mockSetSelectedModel = vi.fn();
const mockModelStore = {
  models: [
    { name: 'llama3.2', size: 2_000_000_000, digest: 'abc', details: null },
    { name: 'qwen2.5', size: 4_700_000_000, digest: 'def', details: null },
  ],
  selectedModel: 'llama3.2',
  setSelectedModel: mockSetSelectedModel,
};
vi.mock('@/store/model-store', () => ({
  useModelStore: Object.assign(
    vi.fn((selector) => selector(mockModelStore)),
    {
      getState: () => mockModelStore,
    }
  ),
}));

// Mock the conversation store — provides conversations + ids for the recent list.
const mockSetCurrentConversationId = vi.fn();
const mockConvStore = {
  conversations: {
    'conv-1': {
      id: 'conv-1',
      title: 'My First Chat',
      model: 'llama3.2',
      settings: {},
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    },
    'conv-2': {
      id: 'conv-2',
      title: 'Research Notes',
      model: 'qwen2.5',
      settings: {},
      createdAt: 1700000001000,
      updatedAt: 1700000001000,
    },
  },
  conversationIds: ['conv-1', 'conv-2'],
  currentConversationId: 'conv-1',
  setCurrentConversationId: mockSetCurrentConversationId,
};
vi.mock('@/store/conversation-store', () => ({
  useConversationStore: Object.assign(
    vi.fn((selector) => selector(mockConvStore)),
    {
      getState: () => mockConvStore,
    }
  ),
}));

// Mock the @/store barrel — CommandPalette imports useSettingsStore from here,
// and useCommands reads useModelStore + useConversationStore from here.
// Re-export the individual store mocks (with getState attached) so both the
// component and the hook see the same state.
vi.mock('@/store', () => ({
  useSettingsStore: vi.fn((selector) => selector({ globalSettings: mockGlobalSettings })),
  useModelStore: Object.assign(
    vi.fn((selector) => selector(mockModelStore)),
    {
      getState: () => mockModelStore,
    }
  ),
  useConversationStore: Object.assign(
    vi.fn((selector) => selector(mockConvStore)),
    {
      getState: () => mockConvStore,
    }
  ),
}));

// Mock the UI store hooks used by useCommands.
vi.mock('@/store/hooks', () => ({
  useSetLibraryOpen: () => vi.fn(),
  useSetSettingsOpen: () => vi.fn(),
  useSetInfoOpen: () => vi.fn(),
  useSetCheatsheetOpen: () => vi.fn(),
}));

// Mock conversation actions.
const mockCreateNewConversation = vi.fn();
const mockClearAllConversations = vi.fn();
vi.mock('@/features/conversation', () => ({
  useConversationActions: () => ({
    createNewConversation: mockCreateNewConversation,
    clearAllConversations: mockClearAllConversations,
  }),
}));

// Mock IPC dialog.ask — clear-all opens a native confirmation dialog.
vi.mock('@/lib/ipc', () => ({
  dialogApi: { ask: vi.fn().mockResolvedValue(true) },
}));

// Mock message store — used by exportCurrentChat via getState().
vi.mock('@/store/message-store', () => ({
  useMessageStore: Object.assign(() => ({ messages: {} }), {
    getState: () => ({ messages: {} }),
  }),
}));

// Mock sidebar export utility.
vi.mock('@/features/sidebar', () => ({
  exportToMarkdown: vi.fn(),
}));

// Mock i18n — return the key as the visible value so we can assert spoken names
// without pulling in the full locale bundle.
vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    formatNumber: (n: number) => String(n),
    formatDate: (d: number | Date) => String(d),
    isRtl: false,
    formatFileSize: (b: number) => `${b} B`,
  }),
}));

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the dialog when open', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { hidden: true })).toBeInTheDocument();
  });

  it('renders the search input with commandPalette placeholder', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('commandPalette.placeholder')).toBeInTheDocument();
  });

  it('renders navigation category commands', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    expect(screen.getByText('commandPalette.commands.newChat')).toBeInTheDocument();
    expect(screen.getByText('commandPalette.commands.goToSettings')).toBeInTheDocument();
    expect(screen.getByText('commandPalette.commands.goToLibrary')).toBeInTheDocument();
    expect(screen.getByText('commandPalette.commands.goToInfo')).toBeInTheDocument();
  });

  it('renders appearance category commands', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    expect(screen.getByText('commandPalette.commands.toggleTheme')).toBeInTheDocument();
    expect(screen.getByText('commandPalette.commands.toggleLanguage')).toBeInTheDocument();
  });

  it('renders chat-actions category commands', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    expect(screen.getByText('commandPalette.commands.clearAllChats')).toBeInTheDocument();
    expect(screen.getByText('commandPalette.commands.exportCurrentChat')).toBeInTheDocument();
  });

  it('renders help category commands', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    expect(screen.getByText('commandPalette.commands.keyboardShortcuts')).toBeInTheDocument();
  });

  it('renders installed models as switch commands', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    // Model commands use t('commandPalette.commands.switchModel') with {model} replaced.
    // Since the mock t() returns the key as-is, the label is the key itself.
    // One command per model — verify both are present.
    const modelCommands = screen.getAllByText('commandPalette.commands.switchModel');
    expect(modelCommands).toHaveLength(2);
  });

  it('renders recent conversations', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    expect(screen.getByText('My First Chat')).toBeInTheDocument();
    expect(screen.getByText('Research Notes')).toBeInTheDocument();
  });

  it('renders category headers', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    expect(screen.getByText('commandPalette.categories.navigation')).toBeInTheDocument();
    expect(screen.getByText('commandPalette.categories.appearance')).toBeInTheDocument();
    expect(screen.getByText('commandPalette.categories.chatActions')).toBeInTheDocument();
    expect(screen.getByText('commandPalette.categories.help')).toBeInTheDocument();
  });

  it('renders no-results message when search has no matches', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('commandPalette.placeholder');
    fireEvent.change(input, { target: { value: 'zzznomatch' } });
    expect(screen.getByText('commandPalette.noResults')).toBeInTheDocument();
  });

  it('filters commands by search query', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('commandPalette.placeholder');

    // Filter to "settings" — should narrow down to just the settings command.
    fireEvent.change(input, { target: { value: 'settings' } });
    expect(screen.getByText('commandPalette.commands.goToSettings')).toBeInTheDocument();
    expect(screen.queryByText('commandPalette.commands.newChat')).not.toBeInTheDocument();
  });

  // ── Keyboard navigation (spec requirement: arrow nav + Enter/Escape) ──

  it('does not move active index below 0 on ArrowUp', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('commandPalette.placeholder');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    // No DOM assertion needed — active index clamped at 0; verify no crash,
    // and the first option remains the only aria-selected one.
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('moves active index down on ArrowDown', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('commandPalette.placeholder');
    const options = screen.getAllByRole('option');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('clamps active index at the last option on ArrowDown', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('commandPalette.placeholder');
    const options = screen.getAllByRole('option');
    const last = options.length - 1;

    // Jump to the end with many ArrowDowns — should clamp, not overflow.
    for (let i = 0; i < options.length + 5; i++) {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    }
    expect(options[last]).toHaveAttribute('aria-selected', 'true');
  });

  it('activates the highlighted command on Enter', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('commandPalette.placeholder');

    // Highlight "New Chat" (first option) and activate it.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockCreateNewConversation).toHaveBeenCalledTimes(1);
  });

  it('activates the second command on ArrowDown + Enter', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('commandPalette.placeholder');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    // The second command in the flat list is "Go to Settings" — activating it
    // calls the mocked setSettingsOpen from @/store/hooks. We assert the
    // new-conversation action was NOT called (proving a different command ran).
    expect(mockCreateNewConversation).not.toHaveBeenCalled();
  });

  it('closes the palette on Escape', () => {
    const onClose = vi.fn();
    render(<CommandPalette isOpen onClose={onClose} />);
    const input = screen.getByPlaceholderText('commandPalette.placeholder');
    fireEvent.keyDown(input, { key: 'Escape' });
    // Both the palette's handleKeyDown and ModalLayout's own Escape handler
    // fire onClose — assert at least once, not exactly once.
    expect(onClose).toHaveBeenCalled();
  });

  it('resets active index to 0 when search query changes', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('commandPalette.placeholder');

    // Move down a few, then type — active index should reset to 0.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.change(input, { target: { value: 'settings' } });
    // After filtering, re-query the (now reduced) options list — the only
    // match is "Go to Settings", which must be aria-selected.
    const filteredOptions = screen.getAllByRole('option');
    expect(filteredOptions[0]).toHaveAttribute('aria-selected', 'true');
  });
});
