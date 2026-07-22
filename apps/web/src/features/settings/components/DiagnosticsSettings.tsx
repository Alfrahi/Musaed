'use client';

import { useState } from 'react';
import { Activity } from 'lucide-react';
import { useLanguage } from '@/store/settings-store';
import { useTranslation } from '@/lib/i18n';
import LogViewer from './LogViewer';
import IpcLatencyPanel from './IpcLatencyPanel';

const DiagnosticsSettings = () => {
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const language = useLanguage();
  const { t } = useTranslation(language);

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity size={14} className="text-zinc-400" />
            <label>{t('settings.systemDiagnostics')}</label>
          </div>
          <button
            onClick={() => setIsLogViewerOpen(true)}
            className="text-[10px] font-bold tracking-widest text-blue-600 uppercase transition-colors hover:text-blue-700"
          >
            {t('settings.viewLogs')}
          </button>
        </div>
        <IpcLatencyPanel />
      </div>
      <LogViewer isOpen={isLogViewerOpen} onClose={() => setIsLogViewerOpen(false)} />
    </>
  );
};

export default DiagnosticsSettings;
