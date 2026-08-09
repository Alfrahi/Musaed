'use client';

import { Keyboard } from 'lucide-react';
import { useGlobalSettings, useLanguage } from '@/store/settings-store';
import { useSettingsActions } from '@/features/settings/hooks/useSettingsActions';
import { useTranslation } from '@/lib/i18n';
import { Toggle } from '@/components/ui/toggle';

const InputSettings = () => {
  const globalSettings = useGlobalSettings();
  const language = useLanguage();
  const { updateGlobalSettings } = useSettingsActions();
  const { t } = useTranslation(language);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-body flex items-center gap-2 font-medium">
        <Keyboard size={14} className="text-zinc-400" />
        <span>{t('settings.enterToSend')}</span>
      </div>

      <div className="rounded-md border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <Toggle
          checked={globalSettings.enterToSend}
          onChange={(next) => updateGlobalSettings({ enterToSend: next })}
          label={t('settings.enterToSend')}
          description={t('settings.enterToSendDescription')}
        />
      </div>
    </div>
  );
};

export default InputSettings;
