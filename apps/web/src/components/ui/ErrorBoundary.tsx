'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, AlertTriangle, WifiOff, HelpCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore } from '@/store/settings-store';
import { logger } from '@/lib/logger';
import { opener } from '@/lib/ipc';
import { sanitizeError } from '@musaed/contracts';
import { config } from '@/lib/config';

interface Props {
  children: ReactNode;
  t: (key: string) => string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorType: 'network' | 'ollama' | 'general';
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorType: 'general',
  };

  public static getDerivedStateFromError(error: Error): State {
    let errorType: 'network' | 'ollama' | 'general' = 'general';

    if (error.message.includes('Ollama')) errorType = 'ollama';
    if (error.message.includes('network') || error.message.includes('connect'))
      errorType = 'network';

    return { hasError: true, error, errorType };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Uncaught application error', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  private getErrorUI = () => {
    const { t } = this.props;
    const { error, errorType } = this.state;

    switch (errorType) {
      case 'network':
        return {
          icon: WifiOff,
          title: t('error.networkError'),
          description: t('error.checkConnection'),
          actions: [
            {
              label: t('error.refresh'),
              onClick: () => window.location.reload(),
              primary: true,
            },
          ],
        };

      case 'ollama':
        return {
          icon: AlertTriangle,
          title: t('error.ollamaError'),
          description: t('error.startOllama'),
          actions: [
            {
              label: t('error.downloadOllama'),
              onClick: () => opener.openUrl('https://ollama.ai'),
              primary: true,
            },
            {
              label: t('common.retry'),
              onClick: () => window.location.reload(),
              primary: false,
            },
          ],
        };

      default:
        return {
          icon: AlertTriangle,
          title: t('error.somethingWentWrong'),
          description: error?.message || t('error.unknownError'),
          actions: [
            {
              label: t('error.refresh'),
              onClick: () => window.location.reload(),
              primary: true,
            },
            {
              label: t('error.report'),
              onClick: () => opener.openUrl('https://github.com/Alfrahi/Musaed/issues'),
              primary: false,
            },
          ],
        };
    }
  };

  public render() {
    const { t } = this.props;

    if (this.state.hasError) {
      const errorUI = this.getErrorUI();
      const Icon = errorUI.icon;

      return (
        <div className="flex h-screen items-center justify-center bg-white ps-4 pe-4 dark:bg-zinc-950">
          <div className="w-full max-w-md space-y-6 text-center">
            <div className="ms-auto me-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
              <Icon size={24} className="text-red-600 dark:text-red-400" />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {errorUI.title}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">{errorUI.description}</p>
            </div>

            {this.state.errorType === 'general' && this.state.error && config.isDev && (
              <details className="text-start">
                <summary className="caption-md cursor-pointer font-bold tracking-widest text-gray-500 uppercase hover:text-gray-700">
                  <HelpCircle size={12} className="me-1 inline" />
                  {t('error.details')}
                </summary>
                <pre className="caption-xs mbs-2 max-h-24 overflow-auto rounded bg-gray-100 p-2 text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                  {sanitizeError(this.state.error).message}
                </pre>
              </details>
            )}

            <div className="flex flex-col gap-2">
              {errorUI.actions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={action.onClick}
                  className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 font-medium transition-all ${
                    action.primary
                      ? 'bg-gray-900 text-white hover:opacity-90 dark:bg-gray-100 dark:text-gray-900'
                      : 'border border-gray-300 text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-900'
                  }`}
                >
                  <RefreshCw size={16} />
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const ErrorBoundaryWithTranslation = ({ children }: { children: ReactNode }) => {
  const globalSettings = useSettingsStore((s) => s.globalSettings);
  const { t } = useTranslation(globalSettings.language);

  return <ErrorBoundary t={t}>{children}</ErrorBoundary>;
};

export default ErrorBoundaryWithTranslation;
