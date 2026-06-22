'use client';

import { HardDrive, Download, Upload, FileText, Trash2 } from 'lucide-react';
import { useGlobalSettings, useLanguage } from '@/features/settings/store/settings-store';
import { useTranslation } from '@/lib/i18n';
import { useStorageActions } from '@/features/settings/hooks/useStorageActions';
import { useSettingsActions } from '@/features/settings/hooks/useSettingsActions';

/** Storage size display card. */
const SizeCard = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-700/50 dark:bg-zinc-800/50">
    <p className="mbe-1 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">{label}</p>
    <p className="font-mono text-sm font-black">{value}</p>
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
      <button
        onClick={onExportJson}
        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-zinc-100 py-2 text-xs font-bold tracking-widest uppercase transition-all hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
      >
        <Download size={14} />
        {labels.exportJson}
      </button>
      <button
        disabled
        onClick={onImportJson}
        className="flex flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-zinc-100 py-2 text-xs font-bold tracking-widest uppercase opacity-40 grayscale transition-all dark:bg-zinc-800"
        title={comingSoon}
      >
        <Upload size={14} />
        {labels.importData}
      </button>
    </div>
    <button
      onClick={onExportMarkdown}
      className="flex items-center justify-center gap-2 rounded-lg border border-zinc-200 py-2 text-xs font-bold tracking-widest text-zinc-600 uppercase transition-all hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >
      <FileText size={14} />
      {labels.exportMarkdown}
    </button>
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
      <div className="flex items-center gap-2 text-sm font-medium">
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
        <div className="flex items-center gap-2 text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
          <Trash2 size={12} />
          <label>{t('settings.storage.autoDelete')}</label>
        </div>
        <select
          value={globalSettings.chatRetentionDays}
          onChange={(e) => updateGlobalSettings({ chatRetentionDays: parseInt(e.target.value) })}
          className="w-full cursor-pointer appearance-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs transition-all outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-200 dark:bg-zinc-800"
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
