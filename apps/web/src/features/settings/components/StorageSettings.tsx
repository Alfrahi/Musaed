'use client';

import { HardDrive, Download, Upload, FileText, Trash2 } from 'lucide-react';
import { useGlobalSettings, useLanguage } from '@/store/settings-store';
import { useTranslation } from '@/lib/i18n';
import { useStorageActions } from '@/features/settings/hooks/useStorageActions';
import { useSettingsActions } from '@/features/settings/hooks/useSettingsActions';
import { Button } from '@/components/ui/button';

/** Storage size display card. */
const SizeCard = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-700/50 dark:bg-zinc-800/50">
    <p className="caption-md mbe-1 font-medium text-zinc-400">{label}</p>
    <p className="text-body font-mono font-black">{value}</p>
  </div>
);

/** Export/import action buttons. */
const ExportActions = ({
  onExportJson,
  onExportMarkdown,
  onImportJson,
  labels,
  comingSoon,
}: {
  onExportJson: () => void;
  onExportMarkdown: () => void;
  onImportJson: () => void;
  labels: { exportJson: string; importData: string; exportMarkdown: string };
  comingSoon: string;
}) => (
  <div className="pbs-2 flex flex-col gap-2">
    <div className="flex gap-2">
      <Button
        variant="ghost"
        onClick={onExportJson}
        className="text-caption flex-1 gap-2 rounded-md bg-zinc-100 py-2 font-medium hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
      >
        <Download size={14} className="mirror-rtl" />
        {labels.exportJson}
      </Button>
      <Button
        variant="ghost"
        disabled
        onClick={onImportJson}
        className="text-caption flex-1 cursor-not-allowed gap-2 rounded-md bg-zinc-100 py-2 font-medium opacity-40 grayscale dark:bg-zinc-800"
        title={comingSoon}
      >
        <Upload size={14} />
        {labels.importData}
      </Button>
    </div>
    <Button
      variant="outline"
      onClick={onExportMarkdown}
      className="text-caption gap-2 rounded-md py-2 font-medium text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >
      <FileText size={14} />
      {labels.exportMarkdown}
    </Button>
  </div>
);

const StorageSettings = () => {
  const globalSettings = useGlobalSettings();
  const language = useLanguage();
  const { updateGlobalSettings } = useSettingsActions();
  const { t, formatFileSize } = useTranslation(language);
  const {
    historySize,
    modelsSize,
    handleExportJson,
    handleExportMarkdownBundle,
    handleImportJson,
  } = useStorageActions();

  const retentionOptions = [
    { value: 0, label: t('settings.storage.retention.never') },
    { value: 30, label: t('settings.storage.retention.30') },
    { value: 90, label: t('settings.storage.retention.90') },
    { value: 180, label: t('settings.storage.retention.180') },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="text-body flex items-center gap-2 font-medium">
        <HardDrive size={14} className="text-zinc-400" />
        <label>{t('settings.storage.title')}</label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SizeCard
          label={t('settings.storage.chatHistory')}
          value={
            historySize !== null ? formatFileSize(historySize) : t('settings.storage.calculating')
          }
        />
        <SizeCard
          label={t('settings.storage.models')}
          value={
            modelsSize !== null ? formatFileSize(modelsSize) : t('settings.storage.calculating')
          }
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="caption-md flex items-center gap-2 font-medium text-zinc-500">
          <Trash2 size={14} />
          <label>{t('settings.storage.autoDelete')}</label>
        </div>
        <select
          value={globalSettings.chatRetentionDays}
          onChange={(e) => updateGlobalSettings({ chatRetentionDays: parseInt(e.target.value) })}
          className="text-caption w-full cursor-pointer appearance-none rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 transition-all outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-200 dark:bg-zinc-800"
        >
          {retentionOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <ExportActions
        onExportJson={handleExportJson}
        onExportMarkdown={handleExportMarkdownBundle}
        onImportJson={handleImportJson}
        labels={{
          exportJson: t('settings.storage.exportJson'),
          importData: t('settings.storage.importData'),
          exportMarkdown: t('settings.storage.exportMarkdown'),
        }}
        comingSoon={t('common.comingSoon')}
      />
    </div>
  );
};

export default StorageSettings;
