import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import OllamaConnectionStatus from './OllamaConnectionStatus';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockReconnect = vi.fn();
const useReducedMotionMock = vi.fn(() => false);

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    motion: {
      div: 'div',
      button: 'button',
      span: 'span',
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => useReducedMotionMock(),
  };
});

vi.mock('@/hooks/useOllamaConnection', () => ({
  useOllamaConnection: () => ({
    connectionState: 'disconnected' as const,
    health: null,
    isHealthy: false,
    isChecking: false,
    reconnect: mockReconnect,
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

describe('OllamaConnectionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReducedMotionMock.mockReturnValue(false);
  });

  it('renders the offline state', () => {
    render(<OllamaConnectionStatus />);
    expect(screen.getByText('chat.offline')).toBeInTheDocument();
  });

  describe('prefers-reduced-motion', () => {
    it('renders without AnimatePresence wrapper when prefers-reduced-motion is set', () => {
      useReducedMotionMock.mockReturnValue(true);
      render(<OllamaConnectionStatus />);
      // The component still renders content — just without motion wrappers
      expect(screen.getByText('chat.offline')).toBeInTheDocument();
      // The retry button should have motion-safe: classes
      const retryButton = screen.getByText('common.retry');
      expect(retryButton.className).toContain('motion-safe:transition-colors');
      expect(retryButton.className).toContain('motion-safe:hover:text-blue-700');
    });

    it('renders with AnimatePresence when prefers-reduced-motion is not set', () => {
      useReducedMotionMock.mockReturnValue(false);
      render(<OllamaConnectionStatus />);
      expect(screen.getByText('chat.offline')).toBeInTheDocument();
      const retryButton = screen.getByText('common.retry');
      expect(retryButton.className).toContain('motion-safe:transition-colors');
    });
  });
});
