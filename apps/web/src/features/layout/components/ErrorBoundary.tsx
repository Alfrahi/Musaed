"use client";

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { RefreshCw, AlertTriangle, WifiOff, HelpCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore } from '@/store';
import { logger } from '@/lib/logger';
import { opener } from '@/lib/ipc';

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
    if (error.message.includes('network') || error.message.includes('connect')) errorType = 'network';

    return { hasError: true, error, errorType };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error("Uncaught application error", {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack
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
              label: t('common.refresh'),
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
              label: 'Download Ollama',
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
              label: 'Report',
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
        <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-950 ps-4 pe-4">
        <div className="max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center ms-auto me-auto">
        <Icon size={24} className="text-red-600 dark:text-red-400" />
        </div>

        <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {errorUI.title}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
        {errorUI.description}
        </p>
        </div>

        {this.state.errorType === 'general' && this.state.error && (
          <details className="text-start">
          <summary className="cursor-pointer text-[10px] text-gray-500 font-bold uppercase tracking-widest hover:text-gray-700">
          <HelpCircle size={12} className="inline me-1" />
          {t('error.details')}
          </summary>
          <pre className="mbs-2 p-2 bg-gray-100 dark:bg-gray-900 rounded text-[9px] overflow-auto max-h-24 text-gray-700 dark:text-gray-300">
          {this.state.error.stack}
          </pre>
          </details>
        )}

        <div className="flex flex-col gap-2">
        {errorUI.actions.map((action, idx) => (
          <button
          key={idx}
          onClick={action.onClick}
          className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all ${
            action.primary
            ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:opacity-90'
            : 'border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-900'
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
  const globalSettings = useSettingsStore(state => state.globalSettings);
  const { t } = useTranslation(globalSettings.language);

  return (
    <ErrorBoundary t={t}>
    {children}
    </ErrorBoundary>
  );
};

export default ErrorBoundaryWithTranslation;