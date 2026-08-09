'use client';

import { FileText, Cpu, Layout, type LucideIcon } from 'lucide-react';
import { useGlobalSettings, useLanguage } from '@/store/settings-store';
import { useSettingsActions } from '@/features/settings/hooks/useSettingsActions';
import { useTranslation, type TranslationKey } from '@/lib/i18n';
import { Toggle } from '@/components/ui/toggle';
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
  const language = useLanguage();
  const { t } = useTranslation(language);
  const Icon = toggle.icon;

  return (
    <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex items-start gap-4">
        <div className="shadow-native rounded-md bg-white p-2 dark:bg-zinc-700">
          <Icon size={16} className="text-zinc-500" />
        </div>
        <Toggle
          checked={isEnabled}
          onChange={onToggle}
          label={t(toggle.label)}
          description={t(toggle.description)}
          className="min-w-0 flex-1"
        />
      </div>
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
      <div className="text-body flex items-center gap-2 font-medium">
        <FileText size={14} className="text-zinc-400" />
        <span>{t('settings.markdown.title')}</span>
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
