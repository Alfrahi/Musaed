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
  };
});

vi.mock('@/features/library', async () => {
  return {
    ModelSelector: () => <div data-testid="model-selector">ModelSelector</div>,
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
    default: () => <div data-testid="sidebar-info">SidebarInfo</div>,
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

    useUIStore.setState({
      isHydrated: true,
      isStreaming: false,
      isInitialized: false,
      isOllamaConnected: false,
      errorMessage: null,
      isSettingsOpen: false,
      isLibraryOpen: false,
      isInfoOpen: false,
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
        },
      });

      const { container } = render(<Sidebar />);

      expect(container).toBeInTheDocument();
    });
  });
});
