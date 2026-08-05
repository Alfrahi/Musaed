import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ModelParamsSettings from './ModelParamsSettings';

// Identity i18n: returns the key verbatim so the test asserts on keys.
vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    formatNumber: (n: number) => n.toString(),
    formatDate: (d: number | Date) => String(d),
    isRtl: false,
    formatFileSize: (b: number) => `${b} B`,
  }),
}));

vi.mock('@/store/settings-store', () => ({
  useLanguage: () => 'en',
}));

describe('ModelParamsSettings — pointer card (per-model refactor)', () => {
  it('renders the modelParameters settings label', () => {
    render(<ModelParamsSettings />);
    expect(screen.getByText('settings.modelParameters')).toBeInTheDocument();
  });

  it('renders the per-model redirect copy', () => {
    render(<ModelParamsSettings />);
    expect(screen.getByText('settings.modelParametersNowPerModel')).toBeInTheDocument();
  });

  it('does NOT render any global sampling sliders (removed by refactor)', () => {
    const { container } = render(<ModelParamsSettings />);
    // No range inputs, no number inputs.
    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(container.querySelector('input[type="number"]')).toBeNull();
  });

  it('does NOT render the showTokenIndicator toggle (removed by refactor)', () => {
    const { container } = render(<ModelParamsSettings />);
    expect(container.querySelector('button[role="switch"]')).toBeNull();
    // And no reference to the i18n key for the toggle.
    expect(screen.queryByText('settings.tokenIndicator')).not.toBeInTheDocument();
  });
});
