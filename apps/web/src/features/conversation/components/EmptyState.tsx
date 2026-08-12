'use client';

import { Bot, Plus, Sparkles, Shield, Download, WifiOff, type LucideIcon } from 'lucide-react';
import { useSettingsStore } from '@/store';
import { useConversationActions } from '@/features/conversation/hooks/useConversationActions';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { motion, useReducedMotion } from 'framer-motion';

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

/** Shared rotated-card + offset-badge motif used by every EmptyState variant. */
const EmptyStateIcon = ({
  icon: Icon,
  badgeIcon: BadgeIcon = Sparkles,
  accent = 'text-blue-500',
  badgeAccent = 'bg-blue-600',
}: {
  icon: LucideIcon;
  badgeIcon?: LucideIcon;
  accent?: string;
  badgeAccent?: string;
}) => (
  <div className="mbe-8 relative">
    <div
      className={`shadow-pro flex h-20 w-20 rotate-3 items-center justify-center rounded-md border border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-900`}
    >
      <Icon size={40} className={accent} />
    </div>
    <div
      className={`inset-be-[-0.5rem] inset-ie-[-0.5rem] shadow-pro absolute flex h-8 w-8 -rotate-12 items-center justify-center rounded-md text-white ${badgeAccent}`}
    >
      <BadgeIcon size={16} />
    </div>
  </div>
);

const entranceAnimation = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: 'easeOut' as const },
} as const;

/** Onboarding CTA shown when no models are installed. */
const NoModelsOnboarding = ({
  t,
  onInstallModel,
  shouldReduceMotion,
}: {
  t: (key: string) => string;
  onInstallModel: () => void;
  shouldReduceMotion: boolean;
}) => {
  const inner = (
    <>
      <EmptyStateIcon
        icon={Download}
        badgeIcon={Sparkles}
        accent="text-amber-500"
        badgeAccent="bg-amber-600"
      />
      <h2 className="mbe-2 text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-100">
        {t('chat.onboarding.noModels')}
      </h2>
      <p className="mbe-10 text-body max-w-md text-center leading-relaxed text-zinc-500 dark:text-zinc-400">
        {t('chat.onboarding.noModelsDescription')}
      </p>
      <Button
        variant="primary"
        size="lg"
        onClick={onInstallModel}
        className="shadow-pro gap-3 rounded-md"
      >
        <Download size={18} className="mirror-rtl" />
        {t('chat.onboarding.installModel')}
      </Button>
    </>
  );

  return shouldReduceMotion ? (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50/30 ps-8 pe-8 dark:bg-zinc-950">
      {inner}
    </div>
  ) : (
    <motion.div
      {...entranceAnimation}
      className="flex flex-1 flex-col items-center justify-center bg-zinc-50/30 ps-8 pe-8 dark:bg-zinc-950"
    >
      {inner}
    </motion.div>
  );
};

/** Onboarding CTA shown when Ollama is unreachable. */
const OllamaOfflineOnboarding = ({
  t,
  onStartOllama,
  shouldReduceMotion,
}: {
  t: (key: string) => string;
  onStartOllama: () => void;
  shouldReduceMotion: boolean;
}) => {
  const inner = (
    <>
      <EmptyStateIcon
        icon={WifiOff}
        badgeIcon={Sparkles}
        accent="text-red-500"
        badgeAccent="bg-red-600"
      />
      <h2 className="mbe-2 text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-100">
        {t('chat.onboarding.ollamaOffline')}
      </h2>
      <p className="mbe-10 text-body max-w-md text-center leading-relaxed text-zinc-500 dark:text-zinc-400">
        {t('chat.onboarding.ollamaOfflineDescription')}
      </p>
      <Button
        variant="outline"
        size="lg"
        onClick={onStartOllama}
        className="shadow-pro gap-3 rounded-md border-red-200 text-red-600 hover:bg-red-50 active:scale-95 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
      >
        <WifiOff size={18} />
        {t('chat.onboarding.startOllama')}
      </Button>
    </>
  );

  return shouldReduceMotion ? (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50/30 ps-8 pe-8 dark:bg-zinc-950">
      {inner}
    </div>
  ) : (
    <motion.div
      {...entranceAnimation}
      className="flex flex-1 flex-col items-center justify-center bg-zinc-50/30 ps-8 pe-8 dark:bg-zinc-950"
    >
      {inner}
    </motion.div>
  );
};

/** Welcome screen shown when no conversation is active, with first-run onboarding CTAs. */
const EmptyState = ({ onboarding }: { onboarding?: OnboardingState }) => {
  const { createNewConversation } = useConversationActions();
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const shouldReduceMotion = useReducedMotion() ?? false;

  if (onboarding?.noModels) {
    return (
      <NoModelsOnboarding
        t={t}
        onInstallModel={onboarding.onInstallModel}
        shouldReduceMotion={shouldReduceMotion}
      />
    );
  }

  if (onboarding?.ollamaOffline) {
    return (
      <OllamaOfflineOnboarding
        t={t}
        onStartOllama={onboarding.onStartOllama}
        shouldReduceMotion={shouldReduceMotion}
      />
    );
  }

  const inner = (
    <>
      <EmptyStateIcon
        icon={Bot}
        badgeIcon={Sparkles}
        accent="text-blue-500"
        badgeAccent="bg-blue-600"
      />

      <h2 className="mbe-2 text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-100">
        {t('chat.welcome', { appName: t('common.appName') })}
      </h2>
      <p className="mbe-10 text-body max-w-md text-center leading-relaxed text-zinc-500 dark:text-zinc-400">
        {t('chat.selectConversation')}
      </p>

      <div className="grid w-full max-w-lg grid-cols-1 gap-4 sm:grid-cols-2">
        <Button
          variant="outline"
          onClick={createNewConversation}
          className="group duration-normal hover:shadow-raised h-auto gap-4 rounded-md border-zinc-200 bg-white p-4 text-start transition-all hover:-translate-y-0.5 hover:border-blue-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-500"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 transition-colors group-hover:text-blue-600 dark:bg-zinc-800">
            <Plus size={20} />
          </div>
          <div>
            <p className="text-body font-bold">{t('sidebar.newChat')}</p>
            <p className="mbs-0.5 caption-md font-bold tracking-widest text-zinc-500 uppercase">
              {t('chat.startFresh')}
            </p>
          </div>
        </Button>
        <div className="duration-normal hover:shadow-raised flex items-center gap-4 rounded-md border border-transparent bg-zinc-100/50 p-4 text-start text-zinc-500 transition-all hover:-translate-y-0.5 dark:bg-zinc-900/50 dark:text-zinc-400">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-200 text-zinc-400 dark:bg-zinc-800">
            <Shield size={20} />
          </div>
          <div>
            <p className="text-body font-bold">{t('chat.privateNote')}</p>
            <p className="mbs-0.5 caption-md font-bold tracking-widest text-zinc-500 uppercase">
              {t('chat.runningLocally')}
            </p>
          </div>
        </div>
      </div>
    </>
  );

  return shouldReduceMotion ? (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50/30 ps-8 pe-8 dark:bg-zinc-950">
      {inner}
    </div>
  ) : (
    <motion.div
      {...entranceAnimation}
      className="flex flex-1 flex-col items-center justify-center bg-zinc-50/30 ps-8 pe-8 dark:bg-zinc-950"
    >
      {inner}
    </motion.div>
  );
};

export default EmptyState;
