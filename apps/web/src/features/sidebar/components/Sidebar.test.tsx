import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import Sidebar from './Sidebar';
import { useUIStore } from '@/store/ui-store';
import { useSettingsStore } from '@/store/settings-store';

// Mutable mock actions that can be customized per test
const mockActions = {
  createNewConversation: vi.fn(),
  deleteConversation: vi.fn(),
  renameConversation: vi.fn(),
  setCurrentConversation: vi.fn(),
  clearConversation: vi.fn(),
  exportConversation: vi.fn(),
};

// reason: the conversation-store mock reads these via closure. They must be
// declared before the `vi.mock` calls below (hoisting inlines module bodies at
// import time, but the closure references the live bindings, so resetting these
// in `beforeEach` resets what the mock selectors return to the Sidebar).
const currentConversationIdRef: { value: string | null } = { value: null };
const lastSetCurrentId: { value: string | null } = { value: null };

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

vi.mock('react-virtuoso', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    Virtuoso: forwardRef(({ data, itemContent }: any, ref) => {
      useImperativeHandle(
        ref,
        () => ({
          scrollToIndex: vi.fn(),
        }),
        []
      );
      if (!data || data.length === 0) {
        return <div data-testid="virtuoso-empty">No conversations</div>;
      }
      return (
        <div data-testid="virtuoso-list">
          {data.map((item: any, i: number) => (
            <div key={i} data-testid="virtuoso-item">
              {itemContent(i, item)}
            </div>
          ))}
        </div>
      );
    }),
  };
});

vi.mock('@/features/conversation/hooks/useConversationActions', async () => {
  const actual = await vi.importActual('@/features/conversation/hooks/useConversationActions');
  return {
    ...(actual as object),
    useConversationActions: () => mockActions,
  };
});

vi.mock('@/store/conversation-store', async () => {
  const actual = await vi.importActual('@/store/conversation-store');
  return {
    ...(actual as object),
    useSearchQuery: () => '',
    useFilteredConversations: () => [
      { id: 'conv-1', title: 'Test Chat 1', createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'conv-2', title: 'Test Chat 2', createdAt: Date.now(), updatedAt: Date.now() },
    ],
    // reason: Sidebar uses these for the listbox arrow-key navigation; we expose
    // writable refs so tests can read what id the keyboard handler set.
    useCurrentConversationId: () => currentConversationIdRef.value,
    useSetCurrentConversationId: () => (id: string) => {
      lastSetCurrentId.value = id;
      currentConversationIdRef.value = id;
    },
  };
});

vi.mock('@/lib/ipc', async () => {
  return {
    checkIsTauri: vi.fn().mockReturnValue(false),
    ollamaApi: {
      getModels: vi.fn().mockResolvedValue([]),
    },
    conversationApi: {
      createConversation: vi.fn().mockResolvedValue('conv-new'),
      deleteConversation: vi.fn().mockResolvedValue(undefined),
      updateConversation: vi.fn().mockResolvedValue(undefined),
    },
    traceApi: {
      append: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('@/features/library', async () => {
  return {
    ModelSelector: () => <div data-testid="model-selector">ModelSelector</div>,
    useModelContextWindow: () => ({ contextWindow: null, loading: false, error: null }),
  };
});

vi.mock('@/features/rag/components/ProjectList', () => ({
  ProjectList: ({ hideHeaderAction }: any) => (
    <div data-testid="project-list">ProjectList {hideHeaderAction ? 'hidden' : 'visible'}</div>
  ),
}));
vi.mock('@/features/rag/components/AddProjectDialog', () => ({
  AddProjectDialog: ({ onClose, onAdded }: any) => (
    <div data-testid="add-project-dialog">
      <button onClick={onClose}>Close</button>
      <button onClick={onAdded}>Add</button>
    </div>
  ),
}));
vi.mock('@/features/rag/hooks/useRagProjects', async () => {
  const actual = await vi.importActual('@/features/rag/hooks/useRagProjects');
  return actual;
});

vi.mock('./SearchInput', async () => {
  return {
    default: () => <input data-testid="search-input" placeholder="Search conversations" />,
  };
});

vi.mock('./SidebarHeader', async () => {
  return {
    default: ({ onCreateNew }: any) => (
      <div data-testid="sidebar-header">
        <button onClick={onCreateNew}>New</button>
      </div>
    ),
  };
});

vi.mock('./SidebarSkeleton', async () => {
  return {
    default: () => <div data-testid="sidebar-skeleton">Loading...</div>,
  };
});

vi.mock('./SidebarInfo', async () => {
  return {
    default: ({ trailing }: any) => (
      <div data-testid="sidebar-info">
        SidebarInfo
        {trailing}
      </div>
    ),
  };
});

vi.mock('./ConversationItem', async () => {
  return {
    default: ({ conversation }: any) => (
      <div data-testid="conversation-item" data-conversation-id={conversation.id}>
        {conversation.title}
      </div>
    ),
  };
});

vi.mock('@/features/sidebar/hooks/useSidebarGrouping', async () => {
  return {
    useSidebarGrouping: () => {
      const virtualItems = [
        { type: 'header' as const, group: 'today' as const, id: 'header-today' },
        {
          type: 'conversation' as const,
          data: { id: 'conv-1', title: 'Test Chat 1' },
          id: 'conv-1',
        },
        {
          type: 'conversation' as const,
          data: { id: 'conv-2', title: 'Test Chat 2' },
          id: 'conv-2',
        },
      ];
      return [virtualItems, vi.fn()];
    },
  };
});

vi.mock('@/features/sidebar/hooks/useSidebarActions', async () => {
  return {
    useSidebarActions: () => ({
      handleClearAll: vi.fn(),
    }),
  };
});

describe('Sidebar', () => {
  beforeEach(() => {
    clearMocks();

    // Reset mock actions between tests
    mockActions.createNewConversation.mockClear();
    mockActions.deleteConversation.mockClear();
    mockActions.renameConversation.mockClear();
    mockActions.setCurrentConversation.mockClear();
    mockActions.clearConversation.mockClear();
    mockActions.exportConversation.mockClear();

    // Reset keyboard-nav tracking state between tests.
    currentConversationIdRef.value = null;
    lastSetCurrentId.value = null;

    useUIStore.setState({
      isHydrated: true,
      isStreaming: false,
      isInitialized: false,
      isOllamaConnected: false,
      errorMessage: null,
      activeModal: null,
      sidebarTab: 'chats',
      showAddProject: false,
      _pendingRehydrations: 0,
    });
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
        sidebarCollapsed: false,
        closeToTray: true,
        showTokenIndicator: true,
      },
    });
  });

  describe('Loading state', () => {
    it('renders skeleton when not hydrated', () => {
      useUIStore.setState({ isHydrated: false });

      render(<Sidebar />);

      expect(screen.getByTestId('sidebar-skeleton')).toBeInTheDocument();
    });
  });

  describe('Tab switching', () => {
    it('renders chats tab active by default', () => {
      render(<Sidebar />);

      const chatsButton = screen.getByRole('button', { name: /chats/i });
      const projectsButton = screen.getByRole('button', { name: /projects/i });

      expect(chatsButton).toBeInTheDocument();
      expect(projectsButton).toBeInTheDocument();
      expect(chatsButton).toHaveClass('bg-zinc-200');
    });

    it('switches to projects tab when clicked', async () => {
      render(<Sidebar />);

      const projectsButton = screen.getByRole('button', { name: /projects/i });
      fireEvent.click(projectsButton);

      await waitFor(() => {
        expect(screen.getByTestId('project-list')).toBeInTheDocument();
      });
    });
  });

  describe('Conversation list', () => {
    it('renders virtualized conversation list', () => {
      render(<Sidebar />);

      expect(screen.getByTestId('virtuoso-list')).toBeInTheDocument();
      expect(screen.getAllByTestId('virtuoso-item')).toHaveLength(3);
    });

    it('renders conversation items with titles', () => {
      render(<Sidebar />);

      expect(screen.getByText('Test Chat 1')).toBeInTheDocument();
      expect(screen.getByText('Test Chat 2')).toBeInTheDocument();
    });

    it('renders group headers', () => {
      render(<Sidebar />);

      expect(screen.getByText(/sidebar\.recentChats/i)).toBeInTheDocument();
    });
  });

  describe('Search functionality', () => {
    it('renders search input', () => {
      render(<Sidebar />);

      expect(screen.getByTestId('search-input')).toBeInTheDocument();
    });

    it('filters conversations when search query is present', async () => {
      const { rerender } = render(<Sidebar />);

      const searchInput = screen.getByTestId('search-input');
      fireEvent.change(searchInput, { target: { value: 'Test' } });

      rerender(<Sidebar />);

      await waitFor(() => {
        expect(screen.getByTestId('virtuoso-list')).toBeInTheDocument();
      });
    });
  });

  describe('Create new conversation', () => {
    it('calls createNewConversation when new button is clicked', async () => {
      render(<Sidebar />);

      const newButton = screen.getByTestId('sidebar-header').querySelector('button');
      if (newButton) {
        fireEvent.click(newButton);
      }

      await waitFor(() => {
        expect(mockActions.createNewConversation).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Collapse from expanded sidebar', () => {
    it('renders a collapse button next to the sidebar info', () => {
      render(<Sidebar />);

      expect(screen.getByRole('button', { name: 'a11y.collapseSidebar' })).toBeInTheDocument();
    });

    it('collapses the sidebar when the collapse button is clicked', () => {
      render(<Sidebar />);

      expect(useSettingsStore.getState().globalSettings.sidebarCollapsed).toBe(false);

      const collapseBtn = screen.getByRole('button', { name: 'a11y.collapseSidebar' });
      fireEvent.click(collapseBtn);

      expect(useSettingsStore.getState().globalSettings.sidebarCollapsed).toBe(true);
    });
  });

  describe('Projects tab', () => {
    it('renders ProjectList when projects tab is active', async () => {
      render(<Sidebar />);

      const projectsButton = screen.getByRole('button', { name: /projects/i });
      fireEvent.click(projectsButton);

      await waitFor(() => {
        expect(screen.getByTestId('project-list')).toBeInTheDocument();
      });
    });

    it('opens add project dialog when new button clicked in projects tab', async () => {
      render(<Sidebar />);

      const projectsButton = screen.getByRole('button', { name: /projects/i });
      fireEvent.click(projectsButton);

      await waitFor(() => {
        expect(screen.getByTestId('project-list')).toBeInTheDocument();
      });

      const newButton = screen.getByTestId('sidebar-header').querySelector('button');
      if (newButton) {
        fireEvent.click(newButton);
      }

      await waitFor(() => {
        expect(screen.getByTestId('add-project-dialog')).toBeInTheDocument();
      });
    });
  });

  describe('RTL support', () => {
    it('applies correct RTL classes when Arabic language is selected', async () => {
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
          sidebarCollapsed: false,
          closeToTray: true,
          showTokenIndicator: true,
        },
      });

      const { container } = render(<Sidebar />);

      expect(container).toBeInTheDocument();
    });
  });

  // ── ARIA listbox semantics ────────────────────────────────
  describe('Conversation listbox', () => {
    it('wraps the virtualized conversation list in a nav with aria-label', () => {
      render(<Sidebar />);
      const nav = document.querySelector('nav[aria-label="a11y.conversationList"]');
      expect(nav).not.toBeNull();
    });

    it('renders a listbox element with aria-label and tabIndex=-1', () => {
      render(<Sidebar />);
      const listbox = screen.getByRole('listbox');
      expect(listbox).toHaveAttribute('aria-label', 'a11y.conversationList');
      expect(listbox).toHaveAttribute('tabindex', '-1');
    });

    it('ArrowDown moves active conversation down through filtered list', () => {
      // Seed the active id to the first conversation so ArrowDown is well-defined.
      currentConversationIdRef.value = 'conv-1';
      render(<Sidebar />);
      const listbox = screen.getByRole('listbox');
      fireEvent.keyDown(listbox, { key: 'ArrowDown' });
      expect(lastSetCurrentId.value).toBe('conv-2');
    });

    it('ArrowUp moves active conversation up through filtered list', () => {
      currentConversationIdRef.value = 'conv-2';
      render(<Sidebar />);
      const listbox = screen.getByRole('listbox');
      fireEvent.keyDown(listbox, { key: 'ArrowUp' });
      expect(lastSetCurrentId.value).toBe('conv-1');
    });

    it('ArrowUp at top is a no-op (stays on first item)', () => {
      currentConversationIdRef.value = 'conv-1';
      render(<Sidebar />);
      const listbox = screen.getByRole('listbox');
      fireEvent.keyDown(listbox, { key: 'ArrowUp' });
      expect(lastSetCurrentId.value).toBeNull();
    });

    it('Home jumps to first conversation', () => {
      currentConversationIdRef.value = 'conv-2';
      render(<Sidebar />);
      const listbox = screen.getByRole('listbox');
      fireEvent.keyDown(listbox, { key: 'Home' });
      expect(lastSetCurrentId.value).toBe('conv-1');
    });

    it('End jumps to last conversation', () => {
      currentConversationIdRef.value = 'conv-1';
      render(<Sidebar />);
      const listbox = screen.getByRole('listbox');
      fireEvent.keyDown(listbox, { key: 'End' });
      expect(lastSetCurrentId.value).toBe('conv-2');
    });

    it('ArrowDown when nothing is active selects the first conversation', () => {
      // currentConversationIdRef.value defaults to null via beforeEach
      render(<Sidebar />);
      const listbox = screen.getByRole('listbox');
      fireEvent.keyDown(listbox, { key: 'ArrowDown' });
      expect(lastSetCurrentId.value).toBe('conv-1');
    });

    it('does not capture unrelated keys (typing in search input is unaffected)', () => {
      currentConversationIdRef.value = 'conv-1';
      render(<Sidebar />);
      const listbox = screen.getByRole('listbox');
      // A non-arrow/non-Home-End key should leave lastSetCurrentId untouched.
      fireEvent.keyDown(listbox, { key: 'a' });
      expect(lastSetCurrentId.value).toBeNull();
    });
  });

  // ── Collapse state ───────────────────────────────────────
  describe('Collapsed state', () => {
    it('renders thin icon-rail with new-chat button, conversation icons, and expand button when sidebarCollapsed is true', () => {
      useSettingsStore.setState((s) => ({
        globalSettings: { ...s.globalSettings, sidebarCollapsed: true },
      }));

      render(<Sidebar />);

      // New-conversation button should be present
      const newChatBtn = screen.getByRole('button', { name: 'a11y.newConversationCollapsed' });
      expect(newChatBtn).toBeInTheDocument();

      // Expand button should be present
      const expandBtn = screen.getByRole('button', { name: 'a11y.expandSidebar' });
      expect(expandBtn).toBeInTheDocument();
      expect(expandBtn).toHaveAttribute('aria-expanded', 'false');

      // Conversation letter icons should be present (one per mocked conversation)
      const conv1Btn = screen.getByRole('button', { name: 'Test Chat 1' });
      const conv2Btn = screen.getByRole('button', { name: 'Test Chat 2' });
      expect(conv1Btn).toBeInTheDocument();
      expect(conv2Btn).toBeInTheDocument();
      expect(conv1Btn).toHaveTextContent('T');
      expect(conv2Btn).toHaveTextContent('T');

      // The normal sidebar content should NOT be present
      expect(screen.queryByTestId('sidebar-header')).not.toBeInTheDocument();
      expect(screen.queryByTestId('sidebar-info')).not.toBeInTheDocument();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('expands the sidebar when the expand button is clicked', () => {
      useSettingsStore.setState((s) => ({
        globalSettings: { ...s.globalSettings, sidebarCollapsed: true },
      }));

      render(<Sidebar />);

      const expandBtn = screen.getByRole('button', { name: 'a11y.expandSidebar' });
      fireEvent.click(expandBtn);

      // After clicking, the store should have sidebarCollapsed: false
      expect(useSettingsStore.getState().globalSettings.sidebarCollapsed).toBe(false);
    });

    it('calls createNewConversation when the new-chat button is clicked', () => {
      useSettingsStore.setState((s) => ({
        globalSettings: { ...s.globalSettings, sidebarCollapsed: true },
      }));

      render(<Sidebar />);

      const newChatBtn = screen.getByRole('button', { name: 'a11y.newConversationCollapsed' });
      fireEvent.click(newChatBtn);

      expect(mockActions.createNewConversation).toHaveBeenCalledTimes(1);
    });

    it('sets the active conversation when a conversation icon is clicked', () => {
      useSettingsStore.setState((s) => ({
        globalSettings: { ...s.globalSettings, sidebarCollapsed: true },
      }));

      render(<Sidebar />);

      const conv2Btn = screen.getByRole('button', { name: 'Test Chat 2' });
      fireEvent.click(conv2Btn);

      expect(lastSetCurrentId.value).toBe('conv-2');
      expect(currentConversationIdRef.value).toBe('conv-2');
    });

    it('marks the active conversation icon with aria-current', () => {
      useSettingsStore.setState((s) => ({
        globalSettings: { ...s.globalSettings, sidebarCollapsed: true },
      }));
      currentConversationIdRef.value = 'conv-1';

      render(<Sidebar />);

      const conv1Btn = screen.getByRole('button', { name: 'Test Chat 1' });
      const conv2Btn = screen.getByRole('button', { name: 'Test Chat 2' });
      expect(conv1Btn).toHaveAttribute('aria-current', 'true');
      expect(conv2Btn).not.toHaveAttribute('aria-current');
    });

    it('has id="sidebar" on the collapsed rail for aria-controls', () => {
      useSettingsStore.setState((s) => ({
        globalSettings: { ...s.globalSettings, sidebarCollapsed: true },
      }));

      render(<Sidebar />);

      const sidebar = document.getElementById('sidebar');
      expect(sidebar).not.toBeNull();
    });
  });
});
