'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useLanguage } from '@/store/settings-store';
import { useTranslation } from '@/lib/i18n';

/**
 * Pointer card shown in the Settings modal. Per-model sampling parameters have
 * moved inline to the model selector dropdown (top bar); this card just
 * directs the user there. The previous global-sliders implementation has been
 * removed because the effective values of these parameters depend on the
 * selected model (see `model-params-store.ts`).
 */
const ModelParamsSettings = () => {
  const language = useLanguage();
  const { t } = useTranslation(language);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-body flex items-center gap-2 font-medium">
        <SlidersHorizontal size={14} className="text-zinc-400" />
        <label>{t('settings.modelParameters')}</label>
      </div>
      <div className="pbs-1 flex items-start gap-3 rounded-md border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
        <SlidersHorizontal size={14} className="mt-0.5 text-zinc-500" />
        <p className="text-caption leading-relaxed text-zinc-500 dark:text-zinc-400">
          {t('settings.modelParametersNowPerModel')}
        </p>
      </div>
    </div>
  );
};

export default ModelParamsSettings;
