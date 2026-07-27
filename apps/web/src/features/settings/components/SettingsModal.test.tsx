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
vi.mock('./ModelParamsSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="params" />,
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
    // The inner content area (the <main> inside the flex row) must be
    // scrollable so tall settings tabs don't clip.
    const main = dialog.querySelector('main');
    expect(main).toBeTruthy();
    expect(main!.className).toContain('overflow-y-auto');
  });
});
