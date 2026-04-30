"use client";

import { FileText, Cpu, Layout, LucideIcon } from 'lucide-react';
import { useGlobalSettings, useLanguage } from '../../../store/hooks';
import { useSettingsActions } from '../hooks/useSettingsActions';
import { useTranslation, TranslationKey } from '../../../lib/i18n';
import { ChatSettings } from '@musaed/contracts';

interface MarkdownToggle {
  id: keyof ChatSettings;
  label: TranslationKey;
  icon: LucideIcon;
  description: TranslationKey;
}

/** Single toggle row with icon, label, description, and switch. */
const ToggleRow = ({
  toggle, isEnabled, onToggle,
}: {
  toggle: MarkdownToggle;
  isEnabled: boolean;
  onToggle: () => void;
}) => {
  const { t } = useTranslation(useLanguage());
  const Icon = toggle.icon;

  return (
    <div className="flex items-start gap-4 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-xl border border-zinc-100 dark:border-zinc-700">
      <div className="p-2 bg-white dark:bg-zinc-700 rounded-lg shadow-sm">
        <Icon size={16} className="text-zinc-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold dark:text-zinc-200">{t(toggle.label)}</p>
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed">{t(toggle.description)}</p>
      </div>
      <button
        onClick={onToggle}
        className={`shrink-0 w-10 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500/20 ltr ${
          isEnabled ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'
        }`}
        role="switch"
        aria-checked={isEnabled}
        dir="ltr"
      >
        <div
          className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${
            isEnabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
};

const TOGGLES: MarkdownToggle[] = [
  { id: 'enableLatex', label: 'settings.markdown.enableLatex', icon: Cpu, description: 'settings.markdown.latexDescription' },
  { id: 'enableMermaid', label: 'settings.markdown.enableMermaid', icon: Layout, description: 'settings.markdown.mermaidDescription' },
];

const MarkdownSettings = () => {
  const globalSettings = useGlobalSettings();
  const language = useLanguage();
  const { updateGlobalSettings } = useSettingsActions();
  const { t } = useTranslation(language);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FileText size={14} className="text-zinc-400" />
        <label>{t('settings.markdown.title')}</label>
      </div>
      <div className="flex flex-col gap-3">
        {TOGGLES.map((toggle) => (
          <ToggleRow
            key={toggle.id}
            toggle={toggle}
            isEnabled={globalSettings[toggle.id] as boolean}
            onToggle={() => updateGlobalSettings({ [toggle.id]: !globalSettings[toggle.id] })}
          />
        ))}
      </div>
    </div>
  );
};

export default MarkdownSettings;
