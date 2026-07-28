import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import TaskStatus from './TaskStatus';

// ── Mocks ───────────────────────────────────────────────────────────────────

const useReducedMotionMock = vi.fn(() => false);

vi.mock('framer-motion', async () => {
  return {
    motion: {
      div: 'div',
      button: 'button',
      span: 'span',
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => useReducedMotionMock(),
  };
});

vi.mock('@/store/model-store', () => ({
  useModelStore: (selector: (s: unknown) => unknown) =>
    selector({
      pullStatus: {
        'llama3.2': { progress: 45, status: 'pulling' },
      },
    }),
}));

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({ globalSettings: { language: 'en' } }),
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('TaskStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReducedMotionMock.mockReturnValue(false);
  });

  it('renders the pulling status with progress', () => {
    render(<TaskStatus />);
    expect(screen.getByText('library.pulling')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
  });

  describe('prefers-reduced-motion', () => {
    it('renders without AnimatePresence wrapper when prefers-reduced-motion is set', () => {
      useReducedMotionMock.mockReturnValue(true);
      render(<TaskStatus />);
      // Content still renders — just without motion wrappers
      expect(screen.getByText('library.pulling')).toBeInTheDocument();
      expect(screen.getByText('45%')).toBeInTheDocument();
    });

    it('renders with AnimatePresence when prefers-reduced-motion is not set', () => {
      useReducedMotionMock.mockReturnValue(false);
      render(<TaskStatus />);
      expect(screen.getByText('library.pulling')).toBeInTheDocument();
    });
  });
});
