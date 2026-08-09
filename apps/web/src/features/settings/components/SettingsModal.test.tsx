import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as SettingsStoreModule from '@/store/settings-store';
import SettingsModal from './SettingsModal';

// Mock settings store — SettingsModal reads language from globalSettings and
// the reset action (not exercised here). Preserve the rest of the module so
// coordinating modules (e.g. store/hooks.ts → coordination.ts) keep compiling.
vi.mock('@/store/settings-store', async (importOriginal) => {
  const actual = await importOriginal<typeof SettingsStoreModule>();
  return {
    ...actual,
    useGlobalSettings: () => ({ language: 'en' }),
  };
});

vi.mock('@/features/settings/hooks/useSettingsActions', () => ({
  useSettingsActions: () => ({ resetGlobalSettings: vi.fn() }),
}));

// Mock i18n — return the key as the visible value so we can assert spoken names
// (e.g. `settings.title`) without pulling in the full locale bundle.
vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    formatNumber: (n: number) => String(n),
    formatDate: (d: number | Date) => String(d),
    isRtl: false,
    formatFileSize: (b: number) => `${b} B`,
  }),
}));

// Mock the IPC dialog.ask — the reset flow opens a native dialog.
vi.mock('@/lib/ipc', () => ({ dialog: { ask: vi.fn().mockResolvedValue(false) } }));

// SettingsModal composes several feature sub-panels; mock them to keep the
// smoke test isolated to SettingsModal's own contract with ModalLayout.
vi.mock('./LanguageSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="language" />,
}));
vi.mock('./ThemeSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="theme" />,
}));
vi.mock('./OllamaSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="ollama" />,
}));
vi.mock('./DiagnosticsSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="diagnostics" />,
}));
vi.mock('./InputSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="input" />,
}));
vi.mock('./StorageSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="storage" />,
}));
vi.mock('./MarkdownSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="markdown" />,
}));

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<SettingsModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog (role + aria-modal) when open', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('associates the dialog with a visible labelled title', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { hidden: true });
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const titleEl = document.getElementById(labelledBy!);
    expect(titleEl).toBeInTheDocument();
    expect(titleEl?.textContent).toBe('settings.title');
  });

  it('routes the close button through onClose', async () => {
    const onClose = vi.fn();
    render(<SettingsModal isOpen onClose={onClose} />);
    const closeBtn = screen.getByLabelText('a11y.closeModal');
    fireEvent.click(closeBtn);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('dismisses on Escape', async () => {
    const onClose = vi.fn();
    render(<SettingsModal isOpen onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('moves focus off <body> into the dialog on open', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
    });
  });

  it('renders the panel with responsive height class', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog.className).toContain('h-[min(85vh,640px)]');
  });

  it('scrolls when content overflows the panel', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { hidden: true });
    // The inner content area (the scrollable ScrollShadow container) must be
    // scrollable so tall settings tabs don't clip.
    const scrollable = dialog.querySelector('[class*="overflow-y-auto"]');
    expect(scrollable).toBeTruthy();
    expect(scrollable!.className).toContain('overflow-y-auto');
  });

  it('renders the search input with placeholder', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText('settings.searchPlaceholder');
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute('type', 'search');
    expect(searchInput).toHaveAttribute('aria-label', 'settings.searchPlaceholder');
  });

  it('filters tabs by search query', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText('settings.searchPlaceholder');

    // All 5 tabs visible initially
    expect(screen.getByText('settings.tabs.general')).toBeInTheDocument();
    expect(screen.getByText('settings.tabs.appearance')).toBeInTheDocument();
    expect(screen.getByText('settings.tabs.ai')).toBeInTheDocument();
    expect(screen.getByText('settings.tabs.storage')).toBeInTheDocument();
    expect(screen.getByText('settings.tabs.advanced')).toBeInTheDocument();

    // Filter to "appearance"
    fireEvent.change(searchInput, { target: { value: 'appearance' } });
    expect(screen.getByText('settings.tabs.appearance')).toBeInTheDocument();
    expect(screen.queryByText('settings.tabs.general')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.tabs.ai')).not.toBeInTheDocument();
  });

  it('navigates to first filtered tab on Enter', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText('settings.searchPlaceholder');

    // Filter to "storage"
    fireEvent.change(searchInput, { target: { value: 'storage' } });
    expect(screen.getByText('settings.tabs.storage')).toBeInTheDocument();

    // Press Enter — should navigate to storage tab and clear search
    fireEvent.keyDown(searchInput, { key: 'Enter' });
    // After Enter, search is cleared so all tabs reappear
    expect(screen.getByText('settings.tabs.general')).toBeInTheDocument();
  });

  it('clears search on Escape', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText('settings.searchPlaceholder');

    fireEvent.change(searchInput, { target: { value: 'ai' } });
    expect(screen.queryByText('settings.tabs.general')).not.toBeInTheDocument();

    fireEvent.keyDown(searchInput, { key: 'Escape' });
    // After Escape, search is cleared so all tabs reappear
    expect(screen.getByText('settings.tabs.general')).toBeInTheDocument();
  });

  it('resets search when modal reopens', () => {
    const { rerender } = render(<SettingsModal isOpen onClose={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText('settings.searchPlaceholder');

    fireEvent.change(searchInput, { target: { value: 'ai' } });
    expect(searchInput).toHaveValue('ai');

    // Close and reopen
    rerender(<SettingsModal isOpen={false} onClose={vi.fn()} />);
    rerender(<SettingsModal isOpen onClose={vi.fn()} />);

    const newSearchInput = screen.getByPlaceholderText('settings.searchPlaceholder');
    expect(newSearchInput).toHaveValue('');
  });

  describe('tablist ARIA semantics', () => {
    it('renders the tab nav as a role=tablist and each tab with role=tab', () => {
      render(<SettingsModal isOpen onClose={vi.fn()} />);
      const tablist = screen.getByRole('tablist');
      expect(tablist).toHaveAttribute('aria-orientation', 'vertical');
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(5);
      for (const tab of tabs) {
        expect(tab.tagName).toBe('BUTTON');
        expect(tab).toHaveAttribute('aria-selected');
        expect(tab).toHaveAttribute('aria-controls');
        expect(tab).toHaveAttribute('id');
      }
    });

    it('marks only the active tab as aria-selected=true', () => {
      render(<SettingsModal isOpen onClose={vi.fn()} />);
      const tabs = screen.getAllByRole('tab');
      const selected = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
      expect(selected).toHaveLength(1);
      // Default active tab is "general".
      expect(selected[0]).toHaveTextContent('settings.tabs.general');
    });

    it('uses a roving tabindex (active=0, inactive=-1)', () => {
      render(<SettingsModal isOpen onClose={vi.fn()} />);
      const tabs = screen.getAllByRole('tab');
      const active = tabs.find((t) => t.getAttribute('aria-selected') === 'true')!;
      const inactive = tabs.filter((t) => t.getAttribute('aria-selected') !== 'true');
      expect(active).toHaveAttribute('tabindex', '0');
      for (const t of inactive) expect(t).toHaveAttribute('tabindex', '-1');
    });

    it('resolves aria-controls on each tab to a real tabpanel element', () => {
      render(<SettingsModal isOpen onClose={vi.fn()} />);
      const tabs = screen.getAllByRole('tab');
      const activeTab = tabs.find((t) => t.getAttribute('aria-selected') === 'true')!;
      const panelId = activeTab.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      const panel = document.getElementById(panelId!);
      expect(panel).not.toBeNull();
      expect(panel).toHaveAttribute('role', 'tabpanel');
      // Bidirectional link: tabpanel aria-labelledby points back at the tab button id.
      expect(panel?.getAttribute('aria-labelledby')).toBe(activeTab.getAttribute('id'));
    });

    it('keeps a single tabpanel mounted for the active tab', () => {
      render(<SettingsModal isOpen onClose={vi.fn()} />);
      const panels = screen.getAllByRole('tabpanel', { hidden: true });
      expect(panels).toHaveLength(1);
    });
  });

  describe('tab roving keyboard navigation', () => {
    it('ArrowDown moves focus to the next tab (wrapping last→first)', () => {
      render(<SettingsModal isOpen onClose={vi.fn()} />);
      const tabs = screen.getAllByRole('tab');
      // Start on the active "general" tab.
      tabs[0].focus();
      expect(document.activeElement).toBe(tabs[0]);
      fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowDown' });
      expect(document.activeElement).toBe(tabs[1]);
      // Follow-focus also updates the active tab.
      expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
      // Wrap from last back to first.
      tabs[tabs.length - 1].focus();
      fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowDown' });
      expect(document.activeElement).toBe(tabs[0]);
    });

    it('ArrowUp moves focus to the previous tab (wrapping first→last)', () => {
      render(<SettingsModal isOpen onClose={vi.fn()} />);
      const tabs = screen.getAllByRole('tab');
      tabs[0].focus();
      fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowUp' });
      expect(document.activeElement).toBe(tabs[tabs.length - 1]);
      expect(tabs[tabs.length - 1]).toHaveAttribute('aria-selected', 'true');
    });

    it('Home focuses the first tab and End the last tab', () => {
      render(<SettingsModal isOpen onClose={vi.fn()} />);
      const tabs = screen.getAllByRole('tab');
      tabs[2].focus();
      fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' });
      expect(document.activeElement).toBe(tabs[0]);
      fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
      expect(document.activeElement).toBe(tabs[tabs.length - 1]);
    });

    it('ArrowRight/ArrowLeft swap direction in RTL mode', async () => {
      // Re-import with an RTL locale to exercise the isRtl branch without
      // weakening the shared hoisted mock that the other tests rely on.
      // vi.doMock overrides the hoisted vi.mock for the next dynamic import;
      // vi.resetModules() guarantees a fresh module graph picks it up.
      vi.resetModules();
      vi.doMock('@/lib/i18n', () => ({
        useTranslation: () => ({
          t: (key: string) => key,
          formatNumber: (n: number) => String(n),
          formatDate: (d: number | Date) => String(d),
          isRtl: true,
          formatFileSize: (b: number) => `${b} B`,
        }),
      }));
      const SettingsModalRtl = (await import('./SettingsModal')).default;
      render(<SettingsModalRtl isOpen onClose={vi.fn()} />);
      const tabs = screen.getAllByRole('tab');
      // In RTL: ArrowRight moves backward (general[0] → advanced[4], wrapping).
      tabs[0].focus();
      fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
      expect(document.activeElement).toBe(tabs[tabs.length - 1]);
      // In RTL: ArrowLeft moves forward (advanced[4] → general[0], wrapping).
      fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
      expect(document.activeElement).toBe(tabs[0]);
      // Restore the hoisted LTR mock for subsequent tests.
      vi.resetModules();
      vi.doUnmock('@/lib/i18n');
    });

    it('focus activates the tab (follow-focus) without a click', () => {
      render(<SettingsModal isOpen onClose={vi.fn()} />);
      const tabs = screen.getAllByRole('tab');
      fireEvent.focus(tabs[2]);
      expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
      expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    });
  });
});
