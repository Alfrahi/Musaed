'use client';

import { useOllamaConnection } from '@/hooks/useOllamaConnection';
import { ConnectionState } from '@/lib';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore } from '@/store/settings-store';
import { AlertCircle, CheckCircle2, Loader2, WifiOff } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

// ── Helpers ─────────────────────────────────────────────────────────────────

interface StatusContentProps {
  isChecking: boolean;
  connectionState: ConnectionState;
  reconnect: () => void;
  t: (key: string) => string;
}

const StatusContent = ({ isChecking, connectionState, reconnect, t }: StatusContentProps) => (
  <>
    {isChecking && (
      <div className="text-caption flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
        <Loader2 size={14} className="animate-spin" />
        <span className="hidden sm:inline">{t('chat.connecting')}</span>
      </div>
    )}

    {connectionState === ConnectionState.DISCONNECTED && (
      <div className="flex items-center gap-2">
        <div className="text-caption flex items-center gap-2 text-red-600 dark:text-red-400">
          <WifiOff size={14} />
          <span className="hidden sm:inline">{t('chat.offline')}</span>
        </div>
        {/* eslint-disable-next-line musaed-buttons/prefer-button-primitive -- inline text-link, not a CVA button */}
        <button
          onClick={reconnect}
          className="caption-xs font-bold text-blue-600 motion-safe:transition-colors motion-safe:hover:text-blue-700"
        >
          {t('common.retry')}
        </button>
      </div>
    )}

    {connectionState === ConnectionState.ERROR && (
      <div className="flex items-center gap-2">
        <div className="text-caption flex items-center gap-2 text-orange-600 dark:text-orange-400">
          <AlertCircle size={14} />
          <span className="hidden sm:inline">{t('error.connectionError')}</span>
        </div>
        {/* eslint-disable-next-line musaed-buttons/prefer-button-primitive -- inline text-link, not a CVA button */}
        <button
          onClick={reconnect}
          className="caption-xs font-bold text-blue-600 motion-safe:transition-colors motion-safe:hover:text-blue-700"
        >
          {t('common.retry')}
        </button>
      </div>
    )}
  </>
);

// ── Component ───────────────────────────────────────────────────────────────

const OllamaConnectionStatus = () => {
  const { connectionState, health, isHealthy, isChecking, reconnect } = useOllamaConnection();
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const shouldReduceMotion = useReducedMotion() ?? false;

  if (isHealthy && !isChecking) {
    return (
      <div className="text-caption flex items-center gap-2 text-green-600 dark:text-green-400">
        <CheckCircle2 size={14} />
        <span className="hidden sm:inline">{t('chat.localNode')}</span>
        {health && <span className="caption-xs">({health.responseTimeMs}ms)</span>}
      </div>
    );
  }

  if (shouldReduceMotion) {
    return (
      <div className="flex items-center gap-2">
        <StatusContent
          isChecking={isChecking}
          connectionState={connectionState}
          reconnect={reconnect}
          t={t}
        />
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={connectionState}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="flex items-center gap-2"
      >
        <StatusContent
          isChecking={isChecking}
          connectionState={connectionState}
          reconnect={reconnect}
          t={t}
        />
      </motion.div>
    </AnimatePresence>
  );
};

export default OllamaConnectionStatus;
