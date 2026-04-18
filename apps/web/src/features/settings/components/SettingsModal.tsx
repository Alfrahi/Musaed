"use client";

import { X, Sliders, RotateCcw } from 'lucide-react';
import { useSettingsStore } from '../../../store';
import { useSettingsActions } from '../hooks/useSettingsActions';
import LanguageSettings from './LanguageSettings';
import ThemeSettings from './ThemeSettings';
import OllamaSettings from './OllamaSettings';
import ModelParamsSettings from './ModelParamsSettings';
import DiagnosticsSettings from './DiagnosticsSettings';
import InputSettings from './InputSettings';
import StorageSettings from './StorageSettings';
import MarkdownSettings from './MarkdownSettings';
import { useTranslation } from '../../../lib/i18n';
import { dialog } from '../../../lib/ipc';
import { ModalLayout } from '../../layout';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
  const { globalSettings } = useSettingsStore();
  const { resetGlobalSettings } = useSettingsActions();
  const { t } = useTranslation(globalSettings.language);

  const handleReset = async () => {
    const confirmed = await dialog.ask(t('settings.confirmReset'), { 
      title: t('settings.resetPreferences'), 
      kind: 'warning' 
    });
    
    if (confirmed) resetGlobalSettings();
  };

  return (
    <ModalLayout isOpen={isOpen} onClose={onClose} maxWidth="max-w-md">
      <div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2 font-semibold">
          <Sliders size={18} className="text-blue-500" aria-hidden="true" />
          <span id="settings-title">{t('settings.title')}</span>
        </div>
        <button 
          onClick={onClose} 
          className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-none transition-all focus-visible:ring-2 focus-visible:ring-blue-500 outline-none"
          aria-label={t('a11y.closeModal')}
        >
          <X size={20} />
        </button>
      </div>

      <div className="p-6 flex flex-col gap-6 max-h-[70vh] overflow-y-auto">
        <LanguageSettings />
        <ThemeSettings />
        <div className="h-[1px] bg-zinc-100 dark:bg-zinc-800" aria-hidden="true" />
        <MarkdownSettings />
        <div className="h-[1px] bg-zinc-100 dark:bg-zinc-800" aria-hidden="true" />
        <InputSettings />
        <div className="h-[1px] bg-zinc-100 dark:bg-zinc-800" aria-hidden="true" />
        <StorageSettings />
        <div className="h-[1px] bg-zinc-100 dark:bg-zinc-800" aria-hidden="true" />
        <DiagnosticsSettings />
        <div className="h-[1px] bg-zinc-100 dark:bg-zinc-800" aria-hidden="true" />
        <OllamaSettings />
        <ModelParamsSettings />
        <div className="h-[1px] bg-zinc-100 dark:bg-zinc-800" aria-hidden="true" />
        <div className="pbs-2">
          <button 
            onClick={handleReset} 
            className="w-full flex items-center justify-center gap-2 py-2.5 border border-zinc-200 dark:border-zinc-800 rounded-none text-xs font-bold uppercase tracking-widest text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all focus-visible:ring-2 focus-visible:ring-blue-500 outline-none"
          >
            <RotateCcw size={14} aria-hidden="true" /> {t('settings.resetPreferences')}
          </button>
        </div>
      </div>

      <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
        <button 
          onClick={onClose} 
          className="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-none text-sm font-medium hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-blue-500 outline-none"
        >
          {t('common.done')}
        </button>
      </div>
    </ModalLayout>
  );
};

export default SettingsModal;