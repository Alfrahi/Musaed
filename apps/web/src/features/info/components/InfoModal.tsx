'use client';

import React from 'react';
import { Info, Github, Shield, Cpu, X, type LucideIcon } from 'lucide-react';
import { ModalLayout } from '@/components/ui';
import { useTranslation } from '../../../lib/i18n';
import { useLanguage } from '../../settings/store/settings-store';
import { opener } from '../../../lib/ipc';

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
      <h3 className="text-xs font-bold tracking-wider uppercase">{title}</h3>
      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{description}</p>
    </div>
  </div>
);

/** Modal header with app icon, name, and version. */
const InfoHeader = ({
  title,
  version,
  onClose,
}: {
  title: string;
  version: string;
  onClose: () => void;
}) => (
  <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 p-6 dark:border-zinc-800">
    <div className="flex items-center gap-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-100 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
        <Info size={20} />
      </div>
      <div>
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">v{version}</p>
      </div>
    </div>
    <button
      onClick={onClose}
      className="rounded-xl p-2 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      <X size={20} />
    </button>
  </div>
);

const InfoModal = ({ isOpen, onClose }: InfoModalProps) => {
  const language = useLanguage();
  const { t } = useTranslation(language);

  const appVersion = '0.1.0';
  const sections = [
    { icon: Shield, title: t('info.privacy.title'), description: t('info.privacy.description') },
    { icon: Cpu, title: t('info.engine.title'), description: t('info.engine.description') },
  ];

  return (
    <ModalLayout isOpen={isOpen} onClose={onClose} maxWidth="max-w-md">
      <InfoHeader title={t('common.appName')} version={appVersion} onClose={onClose} />

      <div className="space-y-6 overflow-y-auto p-6">
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t('info.description')}
        </p>

        <div className="space-y-4">
          {sections.map((section, idx) => (
            <InfoSection key={idx} {...section} />
          ))}
        </div>

        <button
          onClick={() => opener.openUrl('https://github.com/alfrahi/musaed')}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3 text-xs font-bold tracking-widest text-white uppercase shadow-sm transition-all hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
        >
          <Github size={14} />
          {t('info.github')}
        </button>
      </div>

      <div className="flex shrink-0 justify-center border-t border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
        <span className="text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
          © {new Date().getFullYear()} Musaed
        </span>
      </div>
    </ModalLayout>
  );
};

export default InfoModal;
