"use client";

import { HardDrive, Download, Upload, FileText, Trash2 } from 'lucide-react';
import { useGlobalSettings, useLanguage } from '../../../store/hooks';
import { useTranslation } from '../../../lib/i18n';
import { useStorageActions } from '../hooks/useStorageActions';
import { useSettingsActions } from '../hooks/useSettingsActions';

/** Storage size display card. */
const SizeCard = ({ label, value }: { label: string; value: string }) => (
  <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-700/50 rounded-xl">
    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mbe-1">{label}</p>
    <p className="text-sm font-black font-mono">{value}</p>
  </div>
);

/** Export/import action buttons. */
const ExportActions = ({
  onExportJson, onExportMarkdown, onImportJson, labels,
}: {
  onExportJson: () => void;
  onExportMarkdown: () => void;
  onImportJson: () => void;
  labels: { exportJson: string; importData: string; exportMarkdown: string };
}) => (
  <div className="flex flex-col gap-2 pbs-2">
    <div className="flex gap-2">
      <button onClick={onExportJson} className="flex-1 flex items-center justify-center gap-2 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-xs font-bold uppercase tracking-widest transition-all">
        <Download size={14} />{labels.exportJson}
      </button>
      <button disabled onClick={onImportJson} className="flex-1 flex items-center justify-center gap-2 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-xs font-bold uppercase tracking-widest transition-all opacity-40 cursor-not-allowed grayscale" title="Coming soon">
        <Upload size={14} />{labels.importData}
      </button>
    </div>
    <button onClick={onExportMarkdown} className="flex items-center justify-center gap-2 py-2 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg text-xs font-bold uppercase tracking-widest transition-all text-zinc-600 dark:text-zinc-400">
      <FileText size={14} />{labels.exportMarkdown}
    </button>
  </div>
);

const StorageSettings = () => {
  const globalSettings = useGlobalSettings();
  const language = useLanguage();
  const { updateGlobalSettings } = useSettingsActions();
  const { t, formatFileSize } = useTranslation(language);
  const { historySize, modelsSize, handleExportJson, handleExportMarkdownBundle, handleImportJson } = useStorageActions();

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
        <SizeCard label={t('settings.storage.chatHistory')} value={historySize !== null ? formatFileSize(historySize) : t('settings.storage.calculating')} />
        <SizeCard label={t('settings.storage.models')} value={modelsSize !== null ? formatFileSize(modelsSize) : t('settings.storage.calculating')} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
          <Trash2 size={12} />
          <label>{t('settings.storage.autoDelete')}</label>
        </div>
        <select
          value={globalSettings.chatRetentionDays}
          onChange={(e) => updateGlobalSettings({ chatRetentionDays: parseInt(e.target.value) })}
          className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 transition-all appearance-none cursor-pointer"
        >
          {retentionOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      </div>

      <ExportActions
        onExportJson={handleExportJson} onExportMarkdown={handleExportMarkdownBundle} onImportJson={handleImportJson}
        labels={{ exportJson: t('settings.storage.exportJson'), importData: t('settings.storage.importData'), exportMarkdown: t('settings.storage.exportMarkdown') }}
      />
    </div>
  );
};

export default StorageSettings;
