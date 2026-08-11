'use client';

import React, { useId } from 'react';
import { Info, Github, Shield, Cpu, X, type LucideIcon } from 'lucide-react';
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
  <div className="flex gap-4 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
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
          className="text-caption shadow-native w-full gap-2 rounded-xl"
        >
          <Github size={14} />
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
