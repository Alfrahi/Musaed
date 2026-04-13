"use client";

import { useOllamaConnection } from '@/hooks/useOllamaConnection';
import { ConnectionState } from '@/lib/connection-manager';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore } from '@/store';
import { AlertCircle, CheckCircle2, Loader2, WiFiOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function OllamaConnectionStatus() {
    const { connectionState, health, isHealthy, isChecking, reconnect } = useOllamaConnection();
    const { globalSettings } = useSettingsStore();
    const { t } = useTranslation(globalSettings.language);

    if (isHealthy && !isChecking) {
        return (
            <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 size={14} />
            <span className="hidden sm:inline">{t('chat.localNode')}</span>
            {health && <span className="text-[10px] text-zinc-500">({health.responseTimeMs}ms)</span>}
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
        {isChecking && (
            <div className="flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-400">
            <Loader2 size={14} className="animate-spin" />
            <span className="hidden sm:inline">{t('chat.connecting')}</span>
            </div>
        )}

        {connectionState === ConnectionState.DISCONNECTED && (
            <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
            <WiFiOff size={14} />
            <span className="hidden sm:inline">{t('chat.offline')}</span>
            </div>
            <button
            onClick={reconnect}
            className="text-[10px] font-bold text-blue-600 hover:text-blue-700 transition-colors"
            >
            {t('common.retry')}
            </button>
            </div>
        )}

        {connectionState === ConnectionState.ERROR && (
            <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-xs text-orange-600 dark:text-orange-400">
            <AlertCircle size={14} />
            <span className="hidden sm:inline">{t('error.connectionError')}</span>
            </div>
            <button
            onClick={reconnect}
            className="text-[10px] font-bold text-blue-600 hover:text-blue-700 transition-colors"
            >
            {t('common.retry')}
            </button>
            </div>
        )}
        </motion.div>
        </AnimatePresence>
    );
}
