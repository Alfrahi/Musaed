import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClipboard = {
  writeText: vi.fn(),
};

const mockUseContextMenu = vi.fn(() => ({
  showContextMenu: vi.fn(),
}));

vi.mock('@/hooks/useContextMenu', () => ({
  useContextMenu: () => mockUseContextMenu(),
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/store', () => ({
  useSettingsStore: () => ({
    globalSettings: {
      language: 'en',
    },
  }),
}));

beforeEach(() => {
  mockClipboard.writeText.mockClear();
  mockUseContextMenu.mockClear();
  mockUseContextMenu.mockReturnValue({ showContextMenu: vi.fn() });
});

import CodeBlock from './CodeBlock';

describe('CodeBlock', () => {
  it('renders a code block with language label', () => {
    render(<CodeBlock language="python" value="print('hello')" />);

    expect(screen.getByText('python')).toBeTruthy();
    expect(screen.getByText("print('hello')")).toBeTruthy();
  });

  it('renders default "text" label when no language provided', () => {
    render(<CodeBlock value="plain text" />);

    expect(screen.getByText('common.text')).toBeTruthy();
  });

  it('copies code to clipboard when copy button is clicked', async () => {
    Object.assign(navigator, { clipboard: mockClipboard });

    render(<CodeBlock value="const x = 1;" />);

    const copyButton = screen.getByRole('button', { name: 'a11y.copyCode' });
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(mockClipboard.writeText).toHaveBeenCalledWith('const x = 1;');
    });
  });

  it('shows "copied" feedback after clicking copy button', async () => {
    Object.assign(navigator, { clipboard: mockClipboard });

    render(<CodeBlock value="const x = 1;" />);

    const copyButton = screen.getByRole('button', { name: 'a11y.copyCode' });
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(screen.getByText('common.copied')).toBeTruthy();
    });
  });

  it('sets dir="ltr" on the pre element for RTL safety', () => {
    render(<CodeBlock value="const x = 1;" />);

    const pre = screen.getByText('const x = 1;').closest('pre')!;
    expect(pre).toHaveAttribute('dir', 'ltr');
  });

  it('handles empty value gracefully', () => {
    render(<CodeBlock value="" />);

    expect(screen.getByRole('region')).toHaveAttribute('aria-label', 'a11y.codeBlock');
  });
});
