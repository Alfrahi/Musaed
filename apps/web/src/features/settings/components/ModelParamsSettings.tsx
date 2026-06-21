'use client';

import { useGlobalSettings, useLanguage } from '../store/settings-store';
import { useSettingsActions } from '../hooks/useSettingsActions';
import { useTranslation } from '../../../lib/i18n';

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
      <label className="text-xs font-medium text-zinc-500">{label}</label>
      <span className="font-mono text-[10px] text-zinc-400">{displayValue}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-blue-600 dark:bg-zinc-800"
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
    <label className="block text-xs font-medium text-zinc-500">{label}</label>
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value) || fallback)}
      className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 font-mono text-[11px] transition-colors outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
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
          <label className="text-sm font-medium">{t('settings.temperature')}</label>
          <span className="font-mono text-xs text-zinc-500">
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
          className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-blue-600 dark:bg-zinc-800"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SliderControl
          label={t('settings.topP')}
          value={globalSettings.top_p}
          min={0}
          max={1}
          step={0.1}
          displayValue={formatNumber(globalSettings.top_p, { minimumFractionDigits: 1 })}
          onChange={(v) => updateGlobalSettings({ top_p: v })}
        />
        <SliderControl
          label={t('settings.topK')}
          value={globalSettings.top_k}
          min={0}
          max={100}
          step={1}
          displayValue={formatNumber(globalSettings.top_k)}
          onChange={(v) => updateGlobalSettings({ top_k: v })}
        />
      </div>

      <div className="pbs-1 grid grid-cols-2 gap-4">
        <NumberInput
          label={t('settings.contextWindow')}
          value={globalSettings.num_ctx}
          fallback={2048}
          onChange={(v) => updateGlobalSettings({ num_ctx: v })}
        />
        <NumberInput
          label={t('settings.maxTokens')}
          value={globalSettings.num_predict}
          fallback={2048}
          onChange={(v) => updateGlobalSettings({ num_predict: v })}
        />
      </div>
    </div>
  );
};

export default ModelParamsSettings;
