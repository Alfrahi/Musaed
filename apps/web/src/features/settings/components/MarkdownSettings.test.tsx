import { render, screen, fireEvent, within } from '@testing-library/react';
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
// Each toggle row is a flex container holding a label `<p>` and the switch
// `<button role="switch">`. The switch has no `aria-labelledby`, so its
// accessible name is empty and ` getByRole('switch', { name }) ` cannot
// locate it. Instead, we find the row by its visible label text and scope
// the switch query to that row.
const getRowByLabel = (labelKey: string): HTMLElement => {
  const labelEl = screen.getByText(labelKey);
  // The label <p> sits in the flex row whose direct ancestor is the row
  // div that also holds the switch <button>. Walk up to that row. A `<div>`
  // is always an HTMLElement, but `Element.closest` is typed to the broader
  // `Element | null`, so we narrow to `HTMLElement` here.
  const row = labelEl.closest('div.flex');
  if (!row) throw new Error(`toggle row not found for label ${labelKey}`);
  return row as HTMLElement;
};

const getSwitchButton = (labelKey: string) => {
  const row = getRowByLabel(labelKey);
  return within(row).getByRole('switch');
};

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
});
