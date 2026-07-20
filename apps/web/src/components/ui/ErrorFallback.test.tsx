import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock useSettingsStore before importing the component
vi.mock('@/features/settings', () => ({
  useSettingsStore: vi.fn(() => ({
    globalSettings: { language: 'en' },
  })),
}));

// Mock i18n module
vi.mock('@/lib/i18n', () => ({
  useTranslation: vi.fn(() => ({
    t: (key: string) => {
      // Return the key itself if not found, simulating actual i18n lookup
      const translations: Record<string, string> = {
        'fallback.general.title': 'Something went wrong',
        'fallback.general.description': 'An unexpected error occurred. Please try again.',
        'fallback.ollama.title': 'Ollama unavailable',
        'fallback.ollama.description': 'Could not connect to Ollama. Please ensure it is running.',
        'fallback.network.title': 'Connection lost',
        'fallback.network.description': 'Unable to reach the server. Please check your connection.',
        'fallback.notFound.title': 'Not found',
        'fallback.forbidden.title': 'Access denied',
        'fallback.retry': 'Retry',
        'common.close': 'Close',
      };
      return translations[key] ?? key;
    },
  })),
}));

// Import component after mocks are set up
import { ErrorFallback, InlineError } from './ErrorFallback';

describe('ErrorFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ErrorFallback component', () => {
    it('renders with default type and no retry button when onRetry is not provided', () => {
      render(<ErrorFallback />);

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(
        screen.getByText('An unexpected error occurred. Please try again.')
      ).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      // Verify the main container has the correct structure
      const mainContainer = screen.getByText('Something went wrong').parentElement?.parentElement;
      expect(mainContainer).toBeInTheDocument();
      expect(mainContainer?.className).toContain('flex');
    });

    it('renders with custom title and description', () => {
      render(<ErrorFallback title="Custom Error" description="Custom description" />);

      expect(screen.getByText('Custom Error')).toBeInTheDocument();
      expect(screen.getByText('Custom description')).toBeInTheDocument();
    });

    it('renders retry button when onRetry is provided', () => {
      const handleRetry = vi.fn();
      render(<ErrorFallback onRetry={handleRetry} />);

      const retryButton = screen.getByRole('button');
      expect(retryButton).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('calls onRetry when retry button is clicked', () => {
      const handleRetry = vi.fn();
      render(<ErrorFallback onRetry={handleRetry} />);

      fireEvent.click(screen.getByRole('button'));
      expect(handleRetry).toHaveBeenCalledTimes(1);
    });

    it('renders different content based on type', () => {
      const { rerender } = render(<ErrorFallback type="general" />);
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      rerender(<ErrorFallback type="ollama" />);
      expect(screen.getByText('Ollama unavailable')).toBeInTheDocument();

      rerender(<ErrorFallback type="network" />);
      expect(screen.getByText('Connection lost')).toBeInTheDocument();
    });

    it('renders compact variant when compact prop is true', () => {
      render(<ErrorFallback compact onRetry={vi.fn()} />);

      // Verify the main container has compact classes
      const mainContainer = screen.getByText('Something went wrong').parentElement?.parentElement;
      expect(mainContainer).toBeInTheDocument();
      expect(mainContainer?.className).toContain('flex-col');
    });

    it('renders with foridden type', () => {
      render(<ErrorFallback type="forbidden" />);

      expect(screen.getByText('Access denied')).toBeInTheDocument();
    });

    it('renders with notFound type', () => {
      render(<ErrorFallback type="notFound" />);

      expect(screen.getByText('Not found')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      render(<ErrorFallback className="custom-class" />);

      // Verify the main container has the custom class
      const mainContainer = screen.getByText('Something went wrong').parentElement?.parentElement;
      expect(mainContainer).toBeInTheDocument();
      expect(mainContainer?.className).toContain('custom-class');
    });
  });

  describe('InlineError component', () => {
    it('renders error message', () => {
      render(<InlineError message="Something went wrong" />);

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('renders dismiss button when onDismiss is provided', () => {
      const handleDismiss = vi.fn();
      render(<InlineError message="Error" onDismiss={handleDismiss} />);

      const dismissButton = screen.getByLabelText('Close');
      expect(dismissButton).toBeInTheDocument();
    });

    it('calls onDismiss when dismiss button is clicked', () => {
      const handleDismiss = vi.fn();
      render(<InlineError message="Error" onDismiss={handleDismiss} />);

      fireEvent.click(screen.getByLabelText('Close'));
      expect(handleDismiss).toHaveBeenCalledTimes(1);
    });

    it('does not render dismiss button when onDismiss is not provided', () => {
      render(<InlineError message="Error" />);

      expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
    });

    it('applies custom className', () => {
      render(<InlineError message="Error" className="custom-class" />);

      const container = screen.getByText('Error').closest('div');
      expect(container?.className).toContain('custom-class');
    });
  });
});
