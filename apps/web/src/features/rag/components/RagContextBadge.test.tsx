import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import { RagContextBadge } from './RagContextBadge';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';
import { useRagStore } from '@/store/rag-store';
import type { RagProject } from '@musaed/contracts';

// Lightly mock RagExplorer so we can confirm it mounts inside the dialog.
vi.mock('./RagExplorer', () => ({
  RagExplorer: () => <div data-testid="rag-explorer-stub">RagExplorer</div>,
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

const mockProject: RagProject = {
  id: 'proj-1',
  name: 'Active Project',
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
};

describe('RagContextBadge', () => {
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
    useUIStore.setState({ sidebarTab: 'chats' });
    useRagStore.setState({
      projects: { 'proj-1': mockProject },
      projectIds: ['proj-1'],
      activeProjectId: 'proj-1',
    });
  });

  describe('inactive state', () => {
    beforeEach(() => {
      useRagStore.setState({ activeProjectId: null });
    });

    it('renders a pill button labelled with the addProject i18n key', () => {
      render(<RagContextBadge />);
      expect(screen.getByRole('button', { name: 'rag.addProject' })).toBeInTheDocument();
    });

    it('switches the sidebar to the projects tab when clicked', () => {
      render(<RagContextBadge />);
      expect(useUIStore.getState().sidebarTab).toBe('chats');
      fireEvent.click(screen.getByRole('button', { name: 'rag.addProject' }));
      expect(useUIStore.getState().sidebarTab).toBe('projects');
    });
  });

  describe('active state', () => {
    it('renders the project name as a button that opens the RagExplorer dialog', () => {
      render(<RagContextBadge />);
      const projectNameButton = screen.getByRole('button', { name: 'Active Project' });
      expect(projectNameButton).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();

      fireEvent.click(projectNameButton);
      const dialog = screen.getByRole('dialog', { hidden: true });
      expect(dialog).toBeInTheDocument();
      expect(screen.getByTestId('rag-explorer-stub')).toBeInTheDocument();
    });

    it('closes the dialog on Escape', () => {
      render(<RagContextBadge />);
      fireEvent.click(screen.getByRole('button', { name: 'Active Project' }));
      expect(screen.getByRole('dialog', { hidden: true })).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    });

    it('deactivates the active project when the X button is clicked', () => {
      const setStateSpy = vi.spyOn(useRagStore.getState(), 'setActiveProjectId');
      render(<RagContextBadge />);
      const deactivateButton = screen.getByRole('button', {
        name: 'rag.deactivateRag',
      });
      fireEvent.click(deactivateButton);
      expect(setStateSpy).toHaveBeenCalledWith(null);
      setStateSpy.mockRestore();
    });

    it('renders the label with rag.deactivateRag title on the X button', () => {
      render(<RagContextBadge />);
      const x = screen.getByTitle('rag.deactivateRag');
      expect(x).toBeInTheDocument();
    });

    it('X button has 24×24 px minimum tap target (WCAG 2.5.5)', () => {
      render(<RagContextBadge />);
      const x = screen.getByTitle('rag.deactivateRag');
      expect(x.className).toMatch(/\bmin-w-6\b/);
      expect(x.className).toMatch(/\bmin-h-6\b/);
    });
  });
});
