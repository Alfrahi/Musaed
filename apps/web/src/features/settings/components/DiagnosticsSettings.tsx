"use client";

import { useState } from 'react';
import { Activity } from 'lucide-react';
import { useSettingsStore } from '../../../store';
import { useTranslation } from '../../../lib/i18n';
import LogViewer from './LogViewer';

const DiagnosticsSettings = () => {
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const { globalSettings } = useSettingsStore();
  const { t } = useTranslation(globalSettings.language);

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity size={14} className="text-zinc-400" />
            <label>{t('settings.systemDiagnostics')}</label>
          </div>
          <button onClick={() => setIsLogViewerOpen(true)} className="text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-700 transition-colors">
            {t('settings.viewLogs')}
          </button>
        </div>
      </div>
      <LogViewer isOpen={isLogViewerOpen} onClose={() => setIsLogViewerOpen(false)} />
    </>
  );
};

export default DiagnosticsSettings;