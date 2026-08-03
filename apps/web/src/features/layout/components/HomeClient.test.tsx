import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppHeader, default as HomeClient } from './HomeClient';

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: vi.fn((selector) =>
    selector({ globalSettings: { language: 'en', theme: 'light' as const } })
  ),
  useGlobalSettings: () => ({ language: 'en', theme: 'light' as const }),
}));

vi.mock('@/store/hooks', () => ({
  useIsHydrated: () => true,
  useIsLibraryOpen: () => false,
  useIsSettingsOpen: () => false,
  useIsInfoOpen: () => false,
  useSetLibraryOpen: () => vi.fn(),
  useSetSettingsOpen: () => vi.fn(),
  useSetInfoOpen: () => vi.fn(),
  useSetCheatsheetOpen: () => vi.fn(),
  useSetCommandPaletteOpen: () => vi.fn(),
}));

vi.mock('@/store/ui-store', () => ({
  useUIStore: vi.fn((selector) =>
    selector({
      isCheatsheetOpen: false,
      isCommandPaletteOpen: false,
    })
  ),
}));

vi.mock('@/store/coordination', () => ({
  registerHydrationCoordination: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    isRtl: false,
    formatDate: (d: number | Date) => String(d),
    formatNumber: (n: number) => String(n),
    formatFileSize: (b: number) => `${b} B`,
  }),
}));

vi.mock('@/lib/ipc', () => ({
  checkIsTauri: () => false,
}));

vi.mock('@/lib/platform', () => ({
  isMac: () => false,
  isWindows: () => false,
}));

vi.mock('@/hooks/useGlobalShortcuts', () => ({
  useGlobalShortcuts: vi.fn(),
}));

vi.mock('@/hooks/useAppInitialization', () => ({
  useAppInitialization: () => ({ initializeApp: vi.fn() }),
}));

vi.mock('@/hooks/useOllamaConnection', () => ({
  useOllamaConnection: () => ({ reconnect: vi.fn() }),
}));

vi.mock('@/features/conversation', () => ({
  useTauriEvents: vi.fn(),
  useConversationMessages: vi.fn(),
}));

vi.mock('next/dynamic', () => ({
  default: () => {
    const Dyn = () => <div data-testid="dynamic" />;
    Dyn.displayName = 'Dynamic';
    return Dyn;
  },
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- test mock for next/image
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

vi.mock('framer-motion', async () => {
  return {
    motion: {
      div: 'div',
      button: 'button',
      span: 'span',
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

describe('AppHeader', () => {
  const baseProps = {
    isTauri: false,
    isMac: false,
    isWindows: false,
    isRtl: false,
    onLibraryOpen: vi.fn(),
    onSettingsOpen: vi.fn(),
    appName: 'Musaed',
    t: (key: string) => key,
  };

  it('renders the Library button with descriptive title and aria-label', () => {
    render(<AppHeader {...baseProps} />);
    const btn = screen.getByRole('button', { name: 'common.library' });
    expect(btn).toHaveAttribute('title', 'common.library');
    expect(btn).toHaveAttribute('aria-label', 'common.library');
  });

  it('renders the Settings button with descriptive title and aria-label', () => {
    render(<AppHeader {...baseProps} />);
    const btn = screen.getByRole('button', { name: 'settings.title' });
    expect(btn).toHaveAttribute('title', 'settings.title');
    expect(btn).toHaveAttribute('aria-label', 'settings.title');
  });

  it('calls onLibraryOpen when the Library button is clicked', () => {
    const onLibraryOpen = vi.fn();
    render(<AppHeader {...baseProps} onLibraryOpen={onLibraryOpen} />);
    screen.getByRole('button', { name: 'common.library' }).click();
    expect(onLibraryOpen).toHaveBeenCalledOnce();
  });

  it('calls onSettingsOpen when the Settings button is clicked', () => {
    const onSettingsOpen = vi.fn();
    render(<AppHeader {...baseProps} onSettingsOpen={onSettingsOpen} />);
    screen.getByRole('button', { name: 'settings.title' }).click();
    expect(onSettingsOpen).toHaveBeenCalledOnce();
  });

  it('renders the app logo with the appName as alt text', () => {
    render(<AppHeader {...baseProps} appName="Musaed" />);
    expect(screen.getByAltText('Musaed')).toBeInTheDocument();
  });

  it('applies Windows caption-button clearance padding (pe-28) in LTR on Tauri+Windows', () => {
    render(<AppHeader {...baseProps} isTauri isWindows isRtl={false} />);
    const header = screen.getByRole('banner', { hidden: true }) ?? document.querySelector('header');
    expect(header?.className).toContain('pe-28');
    expect(header?.className).not.toContain('ps-20');
  });

  it('applies Windows caption-button clearance padding (ps-28) in RTL on Tauri+Windows', () => {
    render(<AppHeader {...baseProps} isTauri isWindows isRtl />);
    const header = document.querySelector('header');
    expect(header?.className).toContain('ps-28');
  });

  it('applies macOS traffic-light padding (ps-20) in LTR on Tauri+mac', () => {
    render(<AppHeader {...baseProps} isTauri isMac isRtl={false} />);
    const header = document.querySelector('header');
    expect(header?.className).toContain('ps-20');
    expect(header?.className).not.toContain('pe-28');
  });

  it('applies macOS traffic-light padding (pe-20) in RTL on Tauri+mac', () => {
    render(<AppHeader {...baseProps} isTauri isMac isRtl />);
    const header = document.querySelector('header');
    expect(header?.className).toContain('pe-20');
  });

  it('does not apply platform padding when not in Tauri', () => {
    render(<AppHeader {...baseProps} isTauri={false} isWindows />);
    const header = document.querySelector('header');
    expect(header?.className).not.toContain('pe-28');
    expect(header?.className).not.toContain('ps-28');
  });
});

describe('HomeClient', () => {
  it('renders a <main> element with id="main" for the skip-to-content target', () => {
    render(<HomeClient />);
    const main = document.getElementById('main');
    expect(main).not.toBeNull();
    expect(main?.tagName).toBe('MAIN');
  });
});
