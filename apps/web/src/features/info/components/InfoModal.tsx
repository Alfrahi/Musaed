"use client";

import React from 'react';
import { Info, Github, Shield, Cpu, X, LucideIcon } from 'lucide-react';
import { ModalLayout } from '@/components/ui';
import { useTranslation } from '../../../lib/i18n';
import { useLanguage } from '../../../store/hooks';
import { opener } from '../../../lib/ipc';

interface InfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Single info section with icon, title, and description. */
const InfoSection = ({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) => (
  <div className="flex gap-4 p-4 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 rounded-xl">
    <div className="shrink-0 text-blue-500"><Icon size={20} /></div>
    <div className="space-y-1">
      <h3 className="text-xs font-bold uppercase tracking-wider">{title}</h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{description}</p>
    </div>
  </div>
);

/** Modal header with app icon, name, and version. */
const InfoHeader = ({ title, version, onClose }: { title: string; version: string; onClose: () => void }) => (
  <div className="flex items-center justify-between p-6 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
    <div className="flex items-center gap-4">
      <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700">
        <Info size={20} />
      </div>
      <div>
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">v{version}</p>
      </div>
    </div>
    <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all">
      <X size={20} />
    </button>
  </div>
);

const InfoModal = ({ isOpen, onClose }: InfoModalProps) => {
  const language = useLanguage();
  const { t } = useTranslation(language);

  const appVersion = "0.1.0";
  const sections = [
    { icon: Shield, title: t('info.privacy.title'), description: t('info.privacy.description') },
    { icon: Cpu, title: t('info.engine.title'), description: t('info.engine.description') },
  ];

  return (
    <ModalLayout isOpen={isOpen} onClose={onClose} maxWidth="max-w-md">
      <InfoHeader title={t('common.appName')} version={appVersion} onClose={onClose} />

      <div className="p-6 space-y-6 overflow-y-auto">
        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{t('info.description')}</p>

        <div className="space-y-4">
          {sections.map((section, idx) => <InfoSection key={idx} {...section} />)}
        </div>

        <button
          onClick={() => opener.openUrl('https://github.com/alfrahi/musaed')}
          className="flex items-center justify-center gap-2 py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold uppercase tracking-widest rounded-xl hover:opacity-90 transition-all shadow-sm w-full"
        >
          <Github size={14} />{t('info.github')}
        </button>
      </div>

      <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800 flex justify-center shrink-0">
        <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">© {new Date().getFullYear()} Musaed</span>
      </div>
    </ModalLayout>
  );
};

export default InfoModal;
