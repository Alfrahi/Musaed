import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import { ProjectList } from './ProjectList';
import { useSettingsStore } from '@/store/settings-store';
import * as ipc from '@/lib/ipc';
import type * as RagStoreModule from '@/store/rag-store';
import type * as I18nModule from '@/lib/i18n';
import type { RagProject } from '@musaed/contracts';

// ── Mock setup ────────────────────────────────────────────────────────────
// `vi.mock` calls are hoisted to the top of the file by vitest, so they must
// reference factory functions / hoisted helpers only — not local identifiers.
// We expose stateful seams via `vi.hoisted` so the mocks can read/write
// values that the test body later controls.

const removeProjectByIdMock = vi.fn().mockResolvedValue(true);
const setActiveProjectIdMock = vi.fn();
const hoisted = vi.hoisted(() => ({
  projects: {},
  projectIds: [] as string[],
  activeProjectId: null as string | null,
}));

// Stub the `useRagProjects` hook so the test drives the project list and
// asserts the confirm/cancel flow without touching real IPC or the store's
// async dispatch path. `removeProjectById` is the only mutation seam and is
// the thing the spec checks for "called after confirm / not called after
// cancel" (STANDARDS §17 — feature-level hook tests).
vi.mock('../hooks/useRagProjects', () => ({
  useRagProjects: () => ({
    projects: hoisted.projects,
    projectIds: hoisted.projectIds,
    removeProjectById: removeProjectByIdMock,
  }),
}));

// Stub `useRagIndexing` — `startIndexEventListeners` is invoked in a
// `useEffect` on mount; we only need it to return a no-op cleanup. The other
// actions are forwarded to `ProjectCard`, which is also stubbed below.
vi.mock('../hooks/useRagIndexing', () => ({
  useRagIndexing: () => ({
    startIndexing: vi.fn(),
    abortIndexing: vi.fn(),
    retryIndexing: vi.fn(),
    startIndexEventListeners: () => () => undefined,
  }),
}));

vi.mock('./ProjectCard', () => ({
  __esModule: true,
  default: ({ onRemove }: { onRemove: () => void }) => (
    <button type="button" onClick={onRemove} title="removeProject">
      removeProject
    </button>
  ),
}));

vi.mock('./AddProjectDialog', () => ({
  AddProjectDialog: () => <div data-testid="add-project-dialog-stub" />,
}));

// `react-virtuoso` pulls in `ResizeObserver` and other browser-only APIs.
// The component-level suite mocks it with a minimal flat list renderer so
// `ProjectList`'s integration with Virtuoso is exercised in the
// integration tests instead. Each "row" receives the per-item `onRemove`
// callback that `ProjectList` builds in `itemContent`.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: string[];
    itemContent: (i: number, id: string) => ReactNode;
  }) => (
    <div data-testid="virtuoso-stub">
      {data.map((id, i) => (
        <div data-testid={`virtuoso-row-${id}`} key={id}>
          {itemContent(i, id)}
        </div>
      ))}
    </div>
  ),
}));

// `@/store/rag-store` is mocked via hoisted state so the test body can set
// `activeProjectId` per scenario and observe `setActiveProjectId` calls.
vi.mock('@/store/rag-store', async (importOriginal) => {
  const actual = await importOriginal<typeof RagStoreModule>();
  return {
    ...actual,
    useActiveRagProjectId: () => hoisted.activeProjectId,
    useSetActiveRagProjectId: () => setActiveProjectIdMock,
  };
});

vi.mock('@/lib/i18n', async () => {
  const actual = await vi.importActual<typeof I18nModule>('@/lib/i18n');
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

const makeProject = (overrides: Partial<RagProject> = {}): RagProject => ({
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

describe('ProjectList', () => {
  beforeEach(() => {
    clearMocks();
    removeProjectByIdMock.mockReset();
    removeProjectByIdMock.mockResolvedValue(true);
    setActiveProjectIdMock.mockReset();
    hoisted.projects = {};
    hoisted.projectIds = [];
    hoisted.activeProjectId = null;

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

    // `dialog.ask` comes from the global `@/lib/ipc` auto-mock. Reset its
    // return value between tests so each scenario controls confirm/cancel
    // explicitly — no test should inherit a stale mock value.
    vi.mocked(ipc.dialog.ask).mockReset();
  });

  it('renders the add-project button and the empty-state copy when there are no projects', () => {
    hoisted.projects = {};
    hoisted.projectIds = [];
    render(<ProjectList />);
    expect(screen.getByTitle('rag.addProject')).toBeInTheDocument();
    expect(screen.getByText('rag.noProjects')).toBeInTheDocument();
    expect(screen.queryByTitle('removeProject')).toBeNull();
  });

  it('clicking remove → confirm → removeProjectById called with the project id', async () => {
    hoisted.projects = { 'proj-1': makeProject() };
    hoisted.projectIds = ['proj-1'];
    hoisted.activeProjectId = null;

    const dialogAsk = vi.mocked(ipc.dialog.ask);
    dialogAsk.mockResolvedValueOnce(true);

    render(<ProjectList />);
    fireEvent.click(screen.getByTitle('removeProject'));

    await waitFor(() => expect(removeProjectByIdMock).toHaveBeenCalledWith('proj-1'));
    expect(dialogAsk).toHaveBeenCalledWith(
      'rag.removeConfirm',
      expect.objectContaining({
        title: 'rag.removeProject',
        kind: 'warning',
        okLabel: 'common.delete',
        cancelLabel: 'common.cancel',
      })
    );
  });

  it('clicking remove → cancel → removeProjectById is not called', async () => {
    hoisted.projects = { 'proj-1': makeProject() };
    hoisted.projectIds = ['proj-1'];
    hoisted.activeProjectId = null;

    const dialogAsk = vi.mocked(ipc.dialog.ask);
    dialogAsk.mockResolvedValueOnce(false);

    render(<ProjectList />);
    fireEvent.click(screen.getByTitle('removeProject'));

    await waitFor(() => expect(dialogAsk).toHaveBeenCalled());
    // Allow the awaited branch-after-`!confirmed` to flush before re-checking.
    await Promise.resolve();
    expect(removeProjectByIdMock).not.toHaveBeenCalled();
    expect(setActiveProjectIdMock).not.toHaveBeenCalled();
  });

  it('active project removal clears activeProjectId after confirm', async () => {
    hoisted.projects = { 'proj-1': makeProject() };
    hoisted.projectIds = ['proj-1'];
    hoisted.activeProjectId = 'proj-1';

    vi.mocked(ipc.dialog.ask).mockResolvedValueOnce(true);

    render(<ProjectList />);
    fireEvent.click(screen.getByTitle('removeProject'));

    await waitFor(() => expect(removeProjectByIdMock).toHaveBeenCalledWith('proj-1'));
    await waitFor(() => expect(setActiveProjectIdMock).toHaveBeenCalledWith(null));
  });
});
