'use client';

import { FileText, Cpu, Layout, type LucideIcon } from 'lucide-react';
import { useGlobalSettings, useLanguage } from '@/store/settings-store';
import { useSettingsActions } from '@/features/settings/hooks/useSettingsActions';
import { useTranslation, type TranslationKey } from '@/lib/i18n';
import { type ChatSettings } from '@musaed/contracts';

interface MarkdownToggle {
  id: keyof ChatSettings;
  label: TranslationKey;
  icon: LucideIcon;
  description: TranslationKey;
}

/** Single toggle row with icon, label, description, and switch. */
const ToggleRow = ({
  toggle,
  isEnabled,
  onToggle,
}: {
  toggle: MarkdownToggle;
  isEnabled: boolean;
  onToggle: () => void;
}) => {
  const { t } = useTranslation(useLanguage());
  const Icon = toggle.icon;

  return (
    <div className="flex items-start gap-4 rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="rounded-lg bg-white p-2 shadow-sm dark:bg-zinc-700">
        <Icon size={16} className="text-zinc-500" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold dark:text-zinc-200">{t(toggle.label)}</p>
        <p className="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          {t(toggle.description)}
        </p>
      </div>
      <button
        onClick={onToggle}
        className={`ltr focus-visible:ring-offset-background h-6 w-10 shrink-0 rounded-full p-1 transition-colors duration-200 ease-in-out focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none ${
          isEnabled ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'
        }`}
        role="switch"
        aria-checked={isEnabled}
        dir="ltr"
      >
        <div
          className={`h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
            isEnabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
};

const TOGGLES: MarkdownToggle[] = [
  {
    id: 'enableLatex',
    label: 'settings.markdown.enableLatex',
    icon: Cpu,
    description: 'settings.markdown.latexDescription',
  },
  {
    id: 'enableMermaid',
    label: 'settings.markdown.enableMermaid',
    icon: Layout,
    description: 'settings.markdown.mermaidDescription',
  },
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
