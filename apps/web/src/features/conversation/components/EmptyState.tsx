'use client';

import { Bot, Plus, Sparkles, Shield, Download, WifiOff } from 'lucide-react';
import { useSettingsStore } from '@/store';
import { useConversationActions } from '@/features/conversation/hooks/useConversationActions';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

export interface OnboardingState {
  /** true when no models are installed locally */
  noModels: boolean;
  /** true when Ollama is not reachable */
  ollamaOffline: boolean;
  /** opens the Model Library modal */
  onInstallModel: () => void;
  /** triggers an Ollama reconnection attempt */
  onStartOllama: () => void;
}

/** Onboarding CTA shown when no models are installed. */
const NoModelsOnboarding = ({
  t,
  onInstallModel,
}: {
  t: (key: string) => string;
  onInstallModel: () => void;
}) => (
  <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50/30 ps-8 pe-8 dark:bg-zinc-950">
    <div className="mbe-8 relative">
      <div className="flex h-20 w-20 rotate-3 items-center justify-center rounded-md border border-amber-200 bg-amber-50 shadow-xl dark:border-amber-800 dark:bg-amber-900/30">
        <Download size={40} className="text-amber-600" />
      </div>
      <div className="inset-be-[-0.5rem] inset-ie-[-0.5rem] absolute flex h-8 w-8 -rotate-12 items-center justify-center rounded-md bg-amber-600 text-white shadow-lg">
        <Sparkles size={16} />
      </div>
    </div>
    <h2 className="mbe-2 text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-100">
      {t('chat.onboarding.noModels')}
    </h2>
    <p className="mbe-10 max-w-md text-center text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
      {t('chat.onboarding.noModelsDescription')}
    </p>
    <Button
      variant="primary"
      size="lg"
      onClick={onInstallModel}
      className="gap-3 rounded-md shadow-lg"
    >
      <Download size={18} />
      {t('chat.onboarding.installModel')}
    </Button>
  </div>
);

/** Onboarding CTA shown when Ollama is unreachable. */
const OllamaOfflineOnboarding = ({
  t,
  onStartOllama,
}: {
  t: (key: string) => string;
  onStartOllama: () => void;
}) => (
  <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50/30 ps-8 pe-8 dark:bg-zinc-950">
    <div className="mbe-8 relative">
      <div className="flex h-20 w-20 rotate-3 items-center justify-center rounded-md border border-red-200 bg-red-50 shadow-xl dark:border-red-800 dark:bg-red-900/30">
        <WifiOff size={40} className="text-red-600" />
      </div>
      <div className="inset-be-[-0.5rem] inset-ie-[-0.5rem] absolute flex h-8 w-8 -rotate-12 items-center justify-center rounded-md bg-red-600 text-white shadow-lg">
        <Sparkles size={16} />
      </div>
    </div>
    <h2 className="mbe-2 text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-100">
      {t('chat.onboarding.ollamaOffline')}
    </h2>
    <p className="mbe-10 max-w-md text-center text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
      {t('chat.onboarding.ollamaOfflineDescription')}
    </p>
    <Button
      variant="outline"
      size="lg"
      onClick={onStartOllama}
      className="gap-3 rounded-md border-red-200 text-red-600 shadow-lg hover:bg-red-50 active:scale-95 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
    >
      <WifiOff size={18} />
      {t('chat.onboarding.startOllama')}
    </Button>
  </div>
);

/** Welcome screen shown when no conversation is active, with first-run onboarding CTAs. */
const EmptyState = ({ onboarding }: { onboarding?: OnboardingState }) => {
  const { createNewConversation } = useConversationActions();
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);

  if (onboarding?.noModels) {
    return <NoModelsOnboarding t={t} onInstallModel={onboarding.onInstallModel} />;
  }

  if (onboarding?.ollamaOffline) {
    return <OllamaOfflineOnboarding t={t} onStartOllama={onboarding.onStartOllama} />;
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50/30 ps-8 pe-8 dark:bg-zinc-950">
      <div className="mbe-8 relative">
        <div className="flex h-20 w-20 rotate-3 items-center justify-center rounded-md border border-zinc-100 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <Bot size={40} className="text-blue-600" />
        </div>
        <div className="inset-be-[-0.5rem] inset-ie-[-0.5rem] absolute flex h-8 w-8 -rotate-12 items-center justify-center rounded-md bg-blue-600 text-white shadow-lg">
          <Sparkles size={16} />
        </div>
      </div>

      <h2 className="mbe-2 text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-100">
        {t('chat.welcome', { appName: t('common.appName') })}
      </h2>
      <p className="mbe-10 max-w-md text-center text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
        {t('chat.selectConversation')}
      </p>

      <div className="grid w-full max-w-lg grid-cols-1 gap-4 sm:grid-cols-2">
        <Button
          variant="outline"
          onClick={createNewConversation}
          className="group h-auto gap-4 rounded-md border-zinc-200 bg-white p-4 text-start hover:border-blue-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-500"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 transition-colors group-hover:text-blue-600 dark:bg-zinc-800">
            <Plus size={20} />
          </div>
          <div>
            <p className="text-sm font-bold">{t('sidebar.newChat')}</p>
            <p className="mbs-0.5 caption-md font-bold tracking-widest text-zinc-500 uppercase">
              {t('chat.startFresh')}
            </p>
          </div>
        </Button>
        <div className="flex items-center gap-4 rounded-md border border-transparent bg-zinc-100/50 p-4 text-start opacity-60 dark:bg-zinc-900/50">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-200 text-zinc-400 dark:bg-zinc-800">
            <Shield size={20} />
          </div>
          <div>
            <p className="text-sm font-bold">{t('chat.privateNote')}</p>
            <p className="mbs-0.5 caption-md font-bold tracking-widest text-zinc-500 uppercase">
              {t('chat.runningLocally')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmptyState;
