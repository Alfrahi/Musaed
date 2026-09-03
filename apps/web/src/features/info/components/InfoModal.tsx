'use client';

import React, { useId } from 'react';
import { Info, Shield, Cpu, X, type LucideIcon } from 'lucide-react';
import { ModalLayout } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { useLanguage } from '@/store';
import { openerApi } from '@/lib/ipc';
import { useAppVersion } from '@/hooks';

interface InfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** GitHub brand icon (lucide-react 1.x removed brand icons). */
const GithubIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.15c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.16 1.18a11.06 11.06 0 0 1 5.76 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.35.77 1.05.77 2.13v3.15c0 .31.21.67.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
  </svg>
);

/** Single info section with icon, title, and description. */
const InfoSection = ({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) => (
  <div className="flex gap-4 rounded-md border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
    <div className="shrink-0 text-blue-500">
      <Icon size={20} />
    </div>
    <div className="space-y-1">
      <h3 className="text-caption font-bold tracking-wider uppercase">{title}</h3>
      <p className="text-caption leading-relaxed text-zinc-500 dark:text-zinc-400">{description}</p>
    </div>
  </div>
);

/** Modal header with app icon, name, and version. */
const InfoHeader = ({
  title,
  titleId,
  version,
  onClose,
}: {
  title: string;
  titleId: string;
  version: string | null;
  onClose: () => void;
}) => (
  <div className="border-be flex shrink-0 items-center justify-between border-zinc-100 px-4 py-3 dark:border-zinc-800">
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-zinc-100 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
        <Info size={18} />
      </div>
      <div>
        <h2 id={titleId} className="text-heading font-semibold tracking-tight">
          {title}
        </h2>
        {version && (
          <p className="caption-md font-bold tracking-widest text-zinc-500 uppercase">v{version}</p>
        )}
      </div>
    </div>
    <Button
      variant="ghost"
      size="icon"
      onClick={onClose}
      className="rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      <X size={18} />
    </Button>
  </div>
);

const InfoModal = ({ isOpen, onClose }: InfoModalProps) => {
  const language = useLanguage();
  const { t } = useTranslation(language);
  const titleId = useId();

  const { version: appVersion } = useAppVersion();
  const sections = [
    { icon: Shield, title: t('info.privacy.title'), description: t('info.privacy.description') },
    { icon: Cpu, title: t('info.engine.title'), description: t('info.engine.description') },
  ];

  return (
    <ModalLayout isOpen={isOpen} onClose={onClose} titleId={titleId} maxWidth="max-w-md">
      <InfoHeader
        title={t('common.appName')}
        titleId={titleId}
        version={appVersion}
        onClose={onClose}
      />

      <div className="space-y-6 overflow-y-auto p-6">
        <p className="text-body leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t('info.description')}
        </p>

        <div className="space-y-4">
          {sections.map((section, idx) => (
            <InfoSection key={idx} {...section} />
          ))}
        </div>

        <Button
          variant="secondary"
          onClick={() => openerApi.openUrl('https://github.com/alfrahi/musaed')}
          className="text-caption shadow-native w-full gap-2 rounded-md"
        >
          <GithubIcon size={14} />
          {t('info.github')}
        </Button>
      </div>

      <div className="border-bs flex shrink-0 justify-center border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
        <span className="caption-md font-bold tracking-widest text-zinc-400 uppercase">
          © {new Date().getFullYear()} Musaed
        </span>
      </div>
    </ModalLayout>
  );
};

export default InfoModal;
