'use client';

import { useGlobalSettings, useLanguage } from '@/store/settings-store';
import { useSettingsActions } from '@/features/settings/hooks/useSettingsActions';
import { useTranslation } from '@/lib/i18n';

/** Reusable slider control with label and value display. */
const SliderControl = ({
  label,
  value,
  displayValue,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step: number;
  onChange: (val: number) => void;
}) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <label className="text-caption font-medium text-zinc-500">{label}</label>
      <span className="caption-xs font-mono text-zinc-400">{displayValue}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="h-1 w-full cursor-pointer appearance-none rounded-md bg-zinc-200 accent-blue-600 dark:bg-zinc-800"
    />
  </div>
);

/** Number input with label. */
const NumberInput = ({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: number;
  fallback: number;
  onChange: (val: number) => void;
}) => (
  <div className="flex flex-col gap-2">
    <label className="text-caption block font-medium text-zinc-500">{label}</label>
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value) || fallback)}
      className="caption-xs w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 font-mono transition-colors outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
    />
  </div>
);

const ModelParamsSettings = () => {
  const globalSettings = useGlobalSettings();
  const language = useLanguage();
  const { updateGlobalSettings } = useSettingsActions();
  const { t, formatNumber } = useTranslation(language);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-body font-medium">{t('settings.temperature')}</label>
          <span className="text-caption font-mono text-zinc-500">
            {formatNumber(globalSettings.temperature, { minimumFractionDigits: 1 })}
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={globalSettings.temperature}
          onChange={(e) => updateGlobalSettings({ temperature: parseFloat(e.target.value) })}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-md bg-zinc-200 accent-blue-600 dark:bg-zinc-800"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SliderControl
          label={t('settings.topP')}
          value={globalSettings.topP}
          min={0}
          max={1}
          step={0.1}
          displayValue={formatNumber(globalSettings.topP, { minimumFractionDigits: 1 })}
          onChange={(v) => updateGlobalSettings({ topP: v })}
        />
        <SliderControl
          label={t('settings.topK')}
          value={globalSettings.topK}
          min={0}
          max={100}
          step={1}
          displayValue={formatNumber(globalSettings.topK)}
          onChange={(v) => updateGlobalSettings({ topK: v })}
        />
      </div>

      <div className="pbs-1 grid grid-cols-2 gap-4">
        <NumberInput
          label={t('settings.contextWindow')}
          value={globalSettings.numCtx}
          fallback={2048}
          onChange={(v) => updateGlobalSettings({ numCtx: v })}
        />
        <NumberInput
          label={t('settings.maxTokens')}
          value={globalSettings.numPredict}
          fallback={2048}
          onChange={(v) => updateGlobalSettings({ numPredict: v })}
        />
      </div>
    </div>
  );
};

export default ModelParamsSettings;
