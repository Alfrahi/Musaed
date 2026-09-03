import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

const { mockT, mockOpenUrl, mockLoggerError } = vi.hoisted(() => ({
  mockT: vi.fn((key: string) => key),
  mockOpenUrl: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ t: mockT }),
}));

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({ globalSettings: { language: 'en' } }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mockLoggerError, info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/ipc', () => ({
  openerApi: { openUrl: mockOpenUrl },
}));

function Thrower({ error }: { error: Error }): React.ReactNode {
  throw error;
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // React logs caught errors to console — keep test output clean.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>healthy content</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('healthy content')).toBeTruthy();
  });

  it('logs the error with component stack via componentDidCatch', () => {
    render(
      <ErrorBoundary>
        <Thrower error={new Error('boom')} />
      </ErrorBoundary>
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Uncaught application error',
      expect.objectContaining({ error: 'boom' })
    );
  });

  it('classifies Ollama errors and offers a working download action', () => {
    render(
      <ErrorBoundary>
        <Thrower error={new Error('Ollama is not running')} />
      </ErrorBoundary>
    );
    expect(screen.getByText('error.ollamaError')).toBeTruthy();
    fireEvent.click(screen.getByText('error.downloadOllama'));
    expect(mockOpenUrl).toHaveBeenCalledWith('https://ollama.ai');
  });

  it('classifies network errors and shows the connection copy', () => {
    render(
      <ErrorBoundary>
        <Thrower error={new Error('Failed to connect to server')} />
      </ErrorBoundary>
    );
    expect(screen.getByText('error.networkError')).toBeTruthy();
    expect(screen.getByText('error.checkConnection')).toBeTruthy();
  });

  it('collapses to general error with reload + report actions', () => {
    render(
      <ErrorBoundary>
        <Thrower error={new Error('some random defect')} />
      </ErrorBoundary>
    );
    expect(screen.getByText('error.somethingWentWrong')).toBeTruthy();
    expect(screen.getByText('some random defect')).toBeTruthy();
    fireEvent.click(screen.getByText('error.report'));
    expect(mockOpenUrl).toHaveBeenCalledWith('https://github.com/Alfrahi/Musaed/issues');
  });

  it('classifies "connect" messages as network even when mentioning Ollama', () => {
    // getDerivedStateFromError applies the network/connect keyword check last,
    // so it wins over the Ollama check when both markers are present.
    render(
      <ErrorBoundary>
        <Thrower error={new Error('Cannot connect to Ollama')} />
      </ErrorBoundary>
    );
    expect(screen.getByText('error.networkError')).toBeTruthy();
  });
});
