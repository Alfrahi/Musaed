import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type * as SettingsStoreModule from '@/store/settings-store';
import InputSettings from './InputSettings';

// ── Mocks ──────────────────────────────────────────────────────────────────
// `InputSettings` reads `enterToSend` from `globalSettings` and flips it via
// `updateGlobalSettings`. The mutable holder lets successive tests assert the
// on/off states without re-mounting with new props.
const settingsState = { enterToSend: false };
const updateGlobalSettings = vi.fn((patch: Partial<typeof settingsState>) => {
  Object.assign(settingsState, patch);
});

vi.mock('@/store/settings-store', async (importOriginal) => {
  const actual = await importOriginal<typeof SettingsStoreModule>();
  return {
    ...actual,
    useGlobalSettings: () => settingsState,
  };
});

vi.mock('@/features/settings/hooks/useSettingsActions', () => ({
  useSettingsActions: () => ({ updateGlobalSettings }),
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

// ── Helpers ────────────────────────────────────────────────────────────────
const getSwitchButton = () => screen.getByRole('switch');

const getThumb = (switchBtn: HTMLElement): HTMLElement => {
  const thumb = switchBtn.querySelector('div');
  if (!thumb) throw new Error('thumb div not found inside switch');
  return thumb;
};

const setDir = (dir: 'ltr' | 'rtl') => {
  document.documentElement.setAttribute('dir', dir);
};

describe('InputSettings toggle thumb position (RTL/LTR)', () => {
  beforeEach(() => {
    settingsState.enterToSend = false;
    updateGlobalSettings.mockClear();
    setDir('ltr');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('dir');
  });

  it('removes dir="ltr" and the `ltr` className from the switch', () => {
    render(<InputSettings />);
    const sw = getSwitchButton();
    expect(sw.getAttribute('dir')).toBeNull();
    expect(sw.className).not.toMatch(/\bltr\b/);
  });

  it('off state: thumb uses translate-x-0 (shared across LTR/RTL)', () => {
    render(<InputSettings />);
    const thumb = getThumb(getSwitchButton());
    expect(thumb.className).toMatch(/(^|\s)translate-x-0(\s|$)/);
    expect(thumb.className).not.toMatch(/rtl:-translate-x-4/);
    expect(thumb.className).not.toMatch(/ltr:translate-x-4/);
  });

  it('renders the on thumb with ltr:translate-x-4 under LTR when enabled', () => {
    settingsState.enterToSend = true;
    render(<InputSettings />);
    const thumb = getThumb(getSwitchButton());
    expect(thumb.className).toMatch(/(^|\s)ltr:translate-x-4(\s|$)/);
  });

  it('renders the on thumb with rtl:-translate-x-4 under RTL when enabled', () => {
    setDir('rtl');
    settingsState.enterToSend = true;
    render(<InputSettings />);
    const thumb = getThumb(getSwitchButton());
    expect(thumb.className).toMatch(/(^|\s)rtl:-translate-x-4(\s|$)/);
  });

  it('onToggle fires updateGlobalSettings with the inverted value', () => {
    render(<InputSettings />);
    fireEvent.click(getSwitchButton());
    expect(updateGlobalSettings).toHaveBeenCalledWith({ enterToSend: true });
  });

  it('preserves role="switch" + aria-checked semantics', () => {
    settingsState.enterToSend = true;
    render(<InputSettings />);
    const sw = getSwitchButton();
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw.tagName).toBe('BUTTON');
  });
});
