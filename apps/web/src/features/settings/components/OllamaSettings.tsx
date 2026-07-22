'use client';

import React, { useEffect, useRef } from 'react';
import { Globe, Terminal } from 'lucide-react';
import toast from 'react-hot-toast';
import { DEFAULT_SETTINGS } from '@musaed/contracts';
import { useSettingsStore } from '@/store/settings-store';
import { useSettingsActions } from '@/features/settings/hooks/useSettingsActions';
import { useModelActions } from '@/features/library';
import { useTranslation } from '@/lib/i18n';
import { isValidOllamaUrl, sanitizeOllamaUrl, ollamaApi } from '@/lib/ipc';

/** Module-level AbortController so rapid URL changes cancel pending verifications. */
let pendingVerification: AbortController | null = null;

/**
 * Handles Ollama URL validation: sanitizes, validates host, then verifies
 * the target is actually an Ollama instance via a backend handshake.
 */
const handleOllamaUrlBlurFactory = (
  url: string,
  lastValidRef: React.MutableRefObject<string>,
  updateGlobalSettings: (s: { ollamaUrl: string }) => void,
  fetchModels: () => Promise<unknown>,
  t: (key: string) => string
) => {
  const sanitized = sanitizeOllamaUrl(url);

  if (!isValidOllamaUrl(sanitized)) {
    toast.error(t('settings.invalidOllamaUrl'));
    updateGlobalSettings({ ollamaUrl: lastValidRef.current });
    return;
  }

  // Cancel any in-flight verification before starting a new one
  pendingVerification?.abort();
  const controller = new AbortController();
  pendingVerification = controller;

  updateGlobalSettings({ ollamaUrl: sanitized });

  ollamaApi.verifyService(sanitized).then((result) => {
    if (controller.signal.aborted) return;
    if (result === null) {
      toast.error(t('settings.notOllamaService'));
      updateGlobalSettings({ ollamaUrl: lastValidRef.current });
      return;
    }
    lastValidRef.current = sanitized;
    void fetchModels();
  });
};

const OllamaSettings = () => {
  const globalSettings = useSettingsStore((s) => s.globalSettings);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { updateGlobalSettings } = useSettingsActions();
  const { fetchModels } = useModelActions();
  const { t } = useTranslation(language);

  const lastValidOllamaUrlRef = useRef(
    isValidOllamaUrl(globalSettings.ollamaUrl)
      ? globalSettings.ollamaUrl
      : DEFAULT_SETTINGS.ollamaUrl
  );

  useEffect(() => {
    if (isValidOllamaUrl(globalSettings.ollamaUrl)) {
      lastValidOllamaUrlRef.current = globalSettings.ollamaUrl;
    }
  }, [globalSettings.ollamaUrl]);

  const onBlur = () =>
    handleOllamaUrlBlurFactory(
      globalSettings.ollamaUrl,
      lastValidOllamaUrlRef,
      updateGlobalSettings,
      fetchModels,
      t
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Globe size={14} className="text-zinc-400" />
          <label>{t('settings.ollamaUrl')}</label>
        </div>
        <input
          type="text"
          value={globalSettings.ollamaUrl}
          onChange={(e) => updateGlobalSettings({ ollamaUrl: e.target.value })}
          onBlur={onBlur}
          className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2 ps-3 pe-3 text-xs transition-all outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800"
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Terminal size={14} className="text-zinc-400" />
          <label>{t('settings.systemPrompt')}</label>
        </div>
        <textarea
          value={globalSettings.systemPrompt}
          onChange={(e) => updateGlobalSettings({ systemPrompt: e.target.value })}
          className="min-h-[100px] w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs transition-all outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800"
        />
      </div>
    </div>
  );
};

export default OllamaSettings;
