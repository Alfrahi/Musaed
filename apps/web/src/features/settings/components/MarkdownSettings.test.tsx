import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type * as SettingsStoreModule from '@/store/settings-store';
import MarkdownSettings from './MarkdownSettings';

// ── Mocks ──────────────────────────────────────────────────────────────────
// `MarkdownSettings` reads two boolean flags from `globalSettings` and flips
// them through `updateGlobalSettings`. We capture updates in a mutable holder
// so tests can assert the onToggle path, and `useGlobalSettings` reflects the
// current state back into the component under test.
const settingsState = { enableLatex: false, enableMermaid: false };
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
// The Toggle primitive wires aria-labelledby to the visible label, so each
// switch is now locatable by its accessible name via getByRole('switch',
// { name }) — no row-walking helper needed.
const getSwitchButton = (labelKey: string) => screen.getByRole('switch', { name: labelKey });

const getThumb = (switchBtn: HTMLElement): HTMLElement => {
  const thumb = switchBtn.querySelector('div');
  if (!thumb) throw new Error('thumb div not found inside switch');
  return thumb;
};

const setDir = (dir: 'ltr' | 'rtl') => {
  document.documentElement.setAttribute('dir', dir);
};

describe('MarkdownSettings toggle thumb position (RTL/LTR)', () => {
  beforeEach(() => {
    settingsState.enableLatex = false;
    settingsState.enableMermaid = false;
    updateGlobalSettings.mockClear();
    setDir('ltr');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('dir');
  });

  it('removes dir="ltr" and the `ltr` className from the switch', () => {
    render(<MarkdownSettings />);
    const sw = getSwitchButton('settings.markdown.enableLatex');
    expect(sw.getAttribute('dir')).toBeNull();
    expect(sw.className).not.toMatch(/\bltr\b/);
  });

  it('off state: thumb uses translate-x-0 (shared across LTR/RTL)', () => {
    render(<MarkdownSettings />);
    const thumb = getThumb(getSwitchButton('settings.markdown.enableLatex'));
    expect(thumb.className).toMatch(/(^|\s)translate-x-0(\s|$)/);
    expect(thumb.className).not.toMatch(/rtl:-translate-x-4/);
    expect(thumb.className).not.toMatch(/ltr:translate-x-4/);
  });

  it('renders the on thumb with ltr:translate-x-4 under LTR when enabled', () => {
    settingsState.enableMermaid = true;
    render(<MarkdownSettings />);
    const thumb = getThumb(getSwitchButton('settings.markdown.enableMermaid'));
    expect(thumb.className).toMatch(/(^|\s)ltr:translate-x-4(\s|$)/);
  });

  it('renders the on thumb with rtl:-translate-x-4 under RTL when enabled', () => {
    setDir('rtl');
    settingsState.enableLatex = true;
    render(<MarkdownSettings />);
    const thumb = getThumb(getSwitchButton('settings.markdown.enableLatex'));
    expect(thumb.className).toMatch(/(^|\s)rtl:-translate-x-4(\s|$)/);
  });

  it('onToggle fires updateGlobalSettings with the inverted value', () => {
    render(<MarkdownSettings />);
    fireEvent.click(getSwitchButton('settings.markdown.enableMermaid'));
    expect(updateGlobalSettings).toHaveBeenCalledWith({ enableMermaid: true });
  });

  it('preserves role="switch" + aria-checked semantics', () => {
    settingsState.enableLatex = true;
    render(<MarkdownSettings />);
    const sw = getSwitchButton('settings.markdown.enableLatex');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw.tagName).toBe('BUTTON');
  });

  it('associates each label with its switch via aria-labelledby', () => {
    render(<MarkdownSettings />);
    for (const labelKey of ['settings.markdown.enableLatex', 'settings.markdown.enableMermaid']) {
      const sw = getSwitchButton(labelKey);
      const labelledBy = sw.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const labelEl = document.getElementById(labelledBy!);
      expect(labelEl).not.toBeNull();
      expect(labelEl!.textContent).toBe(labelKey);
    }
  });
});
