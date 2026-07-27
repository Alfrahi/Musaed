import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EmptyState, { type OnboardingState } from './EmptyState';

vi.mock('@/lib/i18n', async () => {
  const actual = await vi.importActual('@/lib/i18n');
  return {
    ...(actual as object),
    useTranslation: () => ({
      t: (key: string, values?: Record<string, string | number | boolean>) => {
        if (values?.appName) return key.replace('{appName}', String(values.appName));
        return key;
      },
      formatNumber: (num: number) => num.toString(),
      formatDate: (date: number | Date) => String(date),
      isRtl: false,
      formatFileSize: (bytes: number) => `${bytes} B`,
    }),
  };
});

vi.mock('@/store', () => ({
  useSettingsStore: (selector: (s: any) => any) => {
    const state = { globalSettings: { language: 'en' } };
    return selector(state);
  },
}));

const mockCreateNewConversation = vi.fn();
vi.mock('@/features/conversation/hooks/useConversationActions', () => ({
  useConversationActions: () => ({
    createNewConversation: mockCreateNewConversation,
  }),
}));

describe('EmptyState', () => {
  beforeEach(() => {
    mockCreateNewConversation.mockClear();
  });

  describe('default welcome screen (no onboarding)', () => {
    it('renders the welcome heading', () => {
      render(<EmptyState />);
      expect(screen.getByText('chat.welcome')).toBeInTheDocument();
    });

    it('renders the select-conversation description', () => {
      render(<EmptyState />);
      expect(screen.getByText('chat.selectConversation')).toBeInTheDocument();
    });

    it('renders the New Chat button that calls createNewConversation', () => {
      render(<EmptyState />);
      const btn = screen.getByText('sidebar.newChat');
      fireEvent.click(btn);
      expect(mockCreateNewConversation).toHaveBeenCalledOnce();
    });

    it('renders the privacy badge', () => {
      render(<EmptyState />);
      expect(screen.getByText('chat.privateNote')).toBeInTheDocument();
      expect(screen.getByText('chat.runningLocally')).toBeInTheDocument();
    });
  });

  describe('onboarding: no models installed', () => {
    const noModelsOnboarding: OnboardingState = {
      noModels: true,
      ollamaOffline: false,
      onInstallModel: vi.fn(),
      onStartOllama: vi.fn(),
    };

    it('renders the no-models heading', () => {
      render(<EmptyState onboarding={noModelsOnboarding} />);
      expect(screen.getByText('chat.onboarding.noModels')).toBeInTheDocument();
    });

    it('renders the no-models description', () => {
      render(<EmptyState onboarding={noModelsOnboarding} />);
      expect(screen.getByText('chat.onboarding.noModelsDescription')).toBeInTheDocument();
    });

    it('renders the Install Model button and calls onInstallModel on click', () => {
      render(<EmptyState onboarding={noModelsOnboarding} />);
      const btn = screen.getByText('chat.onboarding.installModel');
      expect(btn).toBeInTheDocument();
      fireEvent.click(btn);
      expect(noModelsOnboarding.onInstallModel).toHaveBeenCalledOnce();
    });

    it('does not render the welcome screen when onboarding is active', () => {
      render(<EmptyState onboarding={noModelsOnboarding} />);
      expect(screen.queryByText('chat.welcome')).not.toBeInTheDocument();
      expect(screen.queryByText('sidebar.newChat')).not.toBeInTheDocument();
    });
  });

  describe('onboarding: Ollama offline', () => {
    const ollamaOfflineOnboarding: OnboardingState = {
      noModels: false,
      ollamaOffline: true,
      onInstallModel: vi.fn(),
      onStartOllama: vi.fn(),
    };

    it('renders the Ollama offline heading', () => {
      render(<EmptyState onboarding={ollamaOfflineOnboarding} />);
      expect(screen.getByText('chat.onboarding.ollamaOffline')).toBeInTheDocument();
    });

    it('renders the Ollama offline description', () => {
      render(<EmptyState onboarding={ollamaOfflineOnboarding} />);
      expect(screen.getByText('chat.onboarding.ollamaOfflineDescription')).toBeInTheDocument();
    });

    it('renders the "Start Ollama" button and calls onStartOllama on click', () => {
      render(<EmptyState onboarding={ollamaOfflineOnboarding} />);
      const btn = screen.getByText('chat.onboarding.startOllama');
      expect(btn).toBeInTheDocument();
      fireEvent.click(btn);
      expect(ollamaOfflineOnboarding.onStartOllama).toHaveBeenCalledOnce();
    });

    it('does not render the welcome screen when Ollama is offline', () => {
      render(<EmptyState onboarding={ollamaOfflineOnboarding} />);
      expect(screen.queryByText('chat.welcome')).not.toBeInTheDocument();
    });
  });

  describe('onboarding: both no models and Ollama offline', () => {
    it('prioritizes no-models over Ollama offline (noModels takes precedence)', () => {
      const bothOnboarding: OnboardingState = {
        noModels: true,
        ollamaOffline: true,
        onInstallModel: vi.fn(),
        onStartOllama: vi.fn(),
      };
      render(<EmptyState onboarding={bothOnboarding} />);
      // noModels is checked first, so it should render
      expect(screen.getByText('chat.onboarding.noModels')).toBeInTheDocument();
      expect(screen.queryByText('chat.onboarding.ollamaOffline')).not.toBeInTheDocument();
    });
  });

  describe('onboarding with falsy flags renders welcome screen', () => {
    it('renders welcome when both flags are false', () => {
      const inactiveOnboarding: OnboardingState = {
        noModels: false,
        ollamaOffline: false,
        onInstallModel: vi.fn(),
        onStartOllama: vi.fn(),
      };
      render(<EmptyState onboarding={inactiveOnboarding} />);
      expect(screen.getByText('chat.welcome')).toBeInTheDocument();
    });
  });
});
