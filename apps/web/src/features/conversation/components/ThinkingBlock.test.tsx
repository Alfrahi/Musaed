import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ThinkingBlock from './ThinkingBlock';

vi.mock('@/store', () => ({
  useSettingsStore: (selector: (s: { globalSettings: { language: string } }) => unknown) =>
    selector({ globalSettings: { language: 'en' } }),
}));

vi.mock('@/lib/i18n', async () => {
  const actual = await vi.importActual('@/lib/i18n');
  return {
    ...(actual as object),
    useTranslation: () => ({
      t: (key: string) => key,
      formatNumber: (n: number) => String(n),
      formatDate: (d: number | Date) => String(d),
      isRtl: false,
      formatFileSize: (b: number) => `${b} B`,
    }),
  };
});

describe('ThinkingBlock', () => {
  it('renders nothing when content is empty and not streaming', () => {
    const { container } = render(<ThinkingBlock content="" isStreaming={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the region with aria-busy=true while streaming', () => {
    render(<ThinkingBlock content="Analyzing..." isStreaming={true} />);
    const region = screen.getByRole('region', { name: 'a11y.thinkingSection' });
    expect(region).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the region with aria-busy=false when not streaming', () => {
    render(<ThinkingBlock content="Done thinking." isStreaming={false} />);
    const region = screen.getByRole('region', { name: 'a11y.thinkingSection' });
    expect(region).toHaveAttribute('aria-busy', 'false');
  });

  it('renders the content container with role="status" and aria-live="polite" while streaming', () => {
    render(<ThinkingBlock content="Thinking..." isStreaming={true} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('renders the content container with aria-live="off" when not streaming', () => {
    render(<ThinkingBlock content="Done." isStreaming={false} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'off');
  });

  it('shows the expand/collapse button with correct aria-expanded', () => {
    render(<ThinkingBlock content="Some thinking" isStreaming={false} />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('auto-expands when streaming starts on a collapsed block', () => {
    const { rerender } = render(
      <ThinkingBlock content="Old thinking" isStreaming={false} isCollapsed={true} />
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');

    rerender(<ThinkingBlock content="Old thinking" isStreaming={true} isCollapsed={true} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the loading spinner while streaming', () => {
    render(<ThinkingBlock content="Thinking..." isStreaming={true} />);
    // Loader2 has aria-hidden="true", so we check for the animate-spin class
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('shows the brain icon when not streaming', () => {
    render(<ThinkingBlock content="Done." isStreaming={false} />);
    // Brain icon has aria-hidden="true"
    const brainIcon = document.querySelector('.lucide-brain');
    expect(brainIcon).toBeInTheDocument();
  });
});
