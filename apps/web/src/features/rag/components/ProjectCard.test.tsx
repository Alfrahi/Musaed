import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import ProjectCard from './ProjectCard';
import { useSettingsStore } from '@/store/settings-store';
import { useRagStore } from '@/store/rag-store';
import type { RagProject } from '@musaed/contracts';
import type * as IpcModule from '@/lib/ipc';

// Stub the Tauri event `listen` adapter so ProjectCard's progress hook
// mounts without subscribing to a real Tauri event. Import the rest of the
// IPC module unchanged so `checkIsTauri` (used by zustand persist during
// `setState` on rag-store) keeps the dev-fallback path working under jsdom.
vi.mock('@/lib/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof IpcModule>();
  return {
    ...actual,
    listen: vi.fn().mockResolvedValue(() => undefined),
  };
});

// Keep the heavy `RagExplorer` / `ProjectSettings` mounts out of this test —
// we only need to assert that opening the modal renders the labelled dialog,
// not the inner explorer contents. Mocking them to diagnosable placeholders
// also avoids mounting `useRagProjects`/`useRagFileBrowser` real IPC. The
// mock paths match ProductionCard's direct sibling imports (`./RagExplorer`,
// `./ProjectSettings`) — not the feature barrel — because ProjectCard
// imported them as siblings to avoid creating a barrel → ProjectList →
// ProjectCard cycle (dep-cruiser `no-circular`).
vi.mock('./RagExplorer', () => ({
  RagExplorer: () => <div data-testid="rag-explorer-stub">RagExplorer</div>,
}));
vi.mock('./ProjectSettings', () => ({
  ProjectSettings: () => <div data-testid="project-settings-stub">ProjectSettings</div>,
}));

const mockProject = (overrides: Partial<RagProject> = {}): RagProject => ({
  id: 'proj-1',
  name: 'Test Project',
  path: '/test/path',
  embeddingModel: 'nomic-embed-text',
  ignorePatterns: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  indexedAt: null,
  fileCount: 0,
  chunkCount: 0,
  totalBytes: 0,
  status: 'ready',
  retryAttempts: 0,
  lastError: null,
  ...overrides,
});

vi.mock('@/lib/i18n', async () => {
  const actual = await vi.importActual('@/lib/i18n');
  return {
    ...(actual as object),
    useTranslation: () => ({
      t: (key: string, values?: Record<string, string | number | boolean>) => {
        if (values && key === 'a11y.browseFiles') return `browse ${values.name}`;
        if (values && key === 'a11y.projectSettings') return `settings ${values.name}`;
        return key;
      },
      formatNumber: (num: number) => num.toString(),
      formatDate: (date: number | Date) => String(date),
      isRtl: false,
      formatFileSize: (bytes: number) => `${bytes} B`,
    }),
  };
});

const baseProps = {
  isActive: false,
  onSelect: vi.fn(),
  onIndex: vi.fn(),
  onReindex: vi.fn(),
  onAbort: vi.fn(),
  onRemove: vi.fn(),
};

describe('ProjectCard', () => {
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
    useRagStore.setState({
      projects: { 'proj-1': mockProject() },
      projectIds: ['proj-1'],
      activeProjectId: null,
    });
  });

  describe('ready project', () => {
    it('renders Browse Files + Settings buttons only when status is ready', () => {
      render(<ProjectCard project={mockProject()} {...baseProps} />);
      expect(screen.getByRole('button', { name: 'browse Test Project' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'settings Test Project' })).toBeInTheDocument();
    });

    it('does not render Browse Files / Settings buttons when status is idle', () => {
      render(<ProjectCard project={mockProject({ status: 'idle' })} {...baseProps} />);
      expect(screen.queryByRole('button', { name: 'browse Test Project' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'settings Test Project' })).toBeNull();
    });

    it('does not render Browse Files / Settings buttons while indexing', () => {
      render(<ProjectCard project={mockProject({ status: 'indexing' })} {...baseProps} />);
      expect(screen.queryByRole('button', { name: 'browse Test Project' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'settings Test Project' })).toBeNull();
    });
  });

  describe('Browse Files modal', () => {
    it('opens RagExplorer in a dialog when the Browse Files button is clicked', () => {
      render(<ProjectCard project={mockProject()} {...baseProps} />);
      const browseButton = screen.getByRole('button', { name: 'browse Test Project' });
      // Stop the click from bubbling to the card row (which would call onSelect).
      fireEvent.click(browseButton);

      const dialog = screen.getByRole('dialog', { hidden: true });
      expect(dialog).toBeInTheDocument();
      expect(screen.getByTestId('rag-explorer-stub')).toBeInTheDocument();
    });

    it('closes the dialog on Escape', () => {
      render(<ProjectCard project={mockProject()} {...baseProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'browse Test Project' }));
      expect(screen.getByRole('dialog', { hidden: true })).toBeInTheDocument();

      // ModalLayout listens for Escape at the document level.
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    });
  });

  describe('Settings modal', () => {
    it('opens ProjectSettings in a dialog when the Settings button is clicked', () => {
      render(<ProjectCard project={mockProject()} {...baseProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'settings Test Project' }));
      const dialog = screen.getByRole('dialog', { hidden: true });
      expect(dialog).toBeInTheDocument();
      expect(screen.getByTestId('project-settings-stub')).toBeInTheDocument();
    });
  });

  describe('card row selection', () => {
    it('selects the project when the row header is clicked (not when action buttons are clicked)', () => {
      const onSelect = vi.fn();
      render(<ProjectCard project={mockProject()} {...baseProps} onSelect={onSelect} />);
      // Click on the row body (not an action button) — find the body by the
      // project name's parent row.
      fireEvent.click(screen.getByText('Test Project'));
      expect(onSelect).toHaveBeenCalled();
    });

    it('does not call onSelect when an action button is clicked (stopPropagation)', () => {
      const onSelect = vi.fn();
      render(<ProjectCard project={mockProject()} {...baseProps} onSelect={onSelect} />);
      fireEvent.click(screen.getByRole('button', { name: 'browse Test Project' }));
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe('active-state toggle icon', () => {
    it('renders a Check icon with deselect aria-label when project is active', () => {
      render(<ProjectCard project={mockProject()} {...baseProps} isActive />);
      const deselectButton = screen.getByRole('button', { name: 'a11y.deselectProject' });
      expect(deselectButton).toBeInTheDocument();
    });

    it('does not render the deselect button when project is not active', () => {
      render(<ProjectCard project={mockProject()} {...baseProps} isActive={false} />);
      expect(screen.queryByRole('button', { name: 'a11y.deselectProject' })).toBeNull();
    });

    it('calls onSelect when the deselect Check button is clicked', () => {
      const onSelect = vi.fn();
      render(<ProjectCard project={mockProject()} {...baseProps} isActive onSelect={onSelect} />);
      fireEvent.click(screen.getByRole('button', { name: 'a11y.deselectProject' }));
      expect(onSelect).toHaveBeenCalled();
    });
  });

  describe('remove button', () => {
    it('renders with aria-label a11y.removeProject', () => {
      render(<ProjectCard project={mockProject()} {...baseProps} />);
      expect(screen.getByRole('button', { name: 'a11y.removeProject' })).toBeInTheDocument();
    });

    it('calls onRemove when clicked', () => {
      const onRemove = vi.fn();
      render(<ProjectCard project={mockProject()} {...baseProps} onRemove={onRemove} />);
      fireEvent.click(screen.getByRole('button', { name: 'a11y.removeProject' }));
      expect(onRemove).toHaveBeenCalled();
    });
  });
});
