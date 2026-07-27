import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SkipToContent from './SkipToContent';

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: vi.fn((selector?: (state: unknown) => unknown) => {
    const state = { globalSettings: { language: 'en' } };
    return selector ? selector(state) : state;
  }),
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

describe('SkipToContent', () => {
  it('renders a link with href="#main"', () => {
    render(<SkipToContent />);
    const link = screen.getByRole('link', { name: 'a11y.skipToContent' });
    expect(link).toHaveAttribute('href', '#main');
  });

  it('is visually hidden by default (sr-only)', () => {
    render(<SkipToContent />);
    const link = screen.getByRole('link', { name: 'a11y.skipToContent' });
    expect(link.className).toContain('sr-only');
  });

  it('becomes visible on focus via focus:not-sr-only', () => {
    render(<SkipToContent />);
    const link = screen.getByRole('link', { name: 'a11y.skipToContent' });
    expect(link.className).toContain('focus:not-sr-only');
  });

  it('has focus styles for positioning and z-index', () => {
    render(<SkipToContent />);
    const link = screen.getByRole('link', { name: 'a11y.skipToContent' });
    expect(link.className).toContain('focus:absolute');
    expect(link.className).toContain('focus:z-50');
  });
});
