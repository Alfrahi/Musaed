import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppHeader } from './HomeClient';

describe('AppHeader', () => {
  const baseProps = {
    isTauri: false,
    isMac: false,
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
});
