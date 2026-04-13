"use client";

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { useTranslation } from '../../../lib/i18n';
import { useSettingsStore } from '../../../store';
import { logger } from '../../../lib/logger';

interface Props {
  children: ReactNode;
  t: (key: string) => string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error("Uncaught application error", {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack
    });
  }

  public render() {
    const { t } = this.props;

    if (this.state.hasError) {
      return (
        <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-950 ps-4 pe-4">
        <div className="max-w-md w-full text-center">
        <div className="mbe-6">
        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center ms-auto me-auto mbe-4">
        <AlertTriangle size={24} className="text-red-600 dark:text-red-400" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mbe-2">
        {t('error.somethingWentWrong')}
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mbe-6">
        {t('error.description')}
        </p>
        </div>

        <button
        onClick={() => window.location.reload()}
        className="w-full flex items-center justify-center gap-2 ps-4 pe-4 py-3 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
        >
        <RefreshCw size={16} />
        {t('error.refresh')}
        </button>
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