'use client';

import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import { VALIDATION_LIMITS, type ModelParamKey } from '@musaed/contracts';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore } from '@/store/settings-store';
import { useModelStore } from '@/store/model-store';
import {
  useModelParamsStore,
  useResolvedModelParams,
  useIsParamOverridden,
} from '@/store/model-params-store';
import { useModelContextWindow } from '../hooks/useModelContextWindow';
import { cn } from '@/lib/utils';

/** Props shared by all slider controls in this panel. */
interface SliderControlProps {
  label: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step: number;
  overridden: boolean;
  onReset: () => void;
  onChange: (val: number) => void;
}

interface NumberInputProps {
  label: string;
  value: number;
  displayValue: string;
  fallback: number;
  min: number;
  max: number;
  overridden: boolean;
  onReset: () => void;
  onChange: (val: number) => void;
  /** Optional hint rendered below the label row (e.g. clamp warning). */
  hint?: string;
}

/** Reusable slider control with label, value display, and reset affordance. */
const SliderControl = ({
  label,
  value,
  displayValue,
  min,
  max,
  step,
  overridden,
  onReset,
  onChange,
}: SliderControlProps) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <label className="caption-md font-medium text-zinc-500">{label}</label>
        {/* eslint-disable-next-line musaed-buttons/prefer-button-primitive -- icon-only reset affordance, not an action button */}
        <button
          type="button"
          onClick={onReset}
          disabled={!overridden}
          aria-label={`${label} reset to default`}
          className={cn(
            'duration-normal rounded p-0.5 transition-colors',
            overridden
              ? 'cursor-pointer text-zinc-400 hover:text-blue-500'
              : 'cursor-default text-transparent'
          )}
        >
          <RotateCcw size={10} />
        </button>
      </div>
      <span
        className={cn(
          'caption-xs font-mono',
          overridden ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'
        )}
      >
        {displayValue}
      </span>
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

/** Number input with label, value display, and reset affordance. */
const NumberInput = ({
  label,
  value,
  displayValue,
  fallback,
  min,
  max,
  overridden,
  onReset,
  onChange,
  hint,
}: NumberInputProps) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <label className="caption-md block font-medium text-zinc-500">{label}</label>
        {/* eslint-disable-next-line musaed-buttons/prefer-button-primitive -- icon-only reset affordance, not an action button */}
        <button
          type="button"
          onClick={onReset}
          disabled={!overridden}
          aria-label={`${label} reset to default`}
          className={cn(
            'duration-normal rounded p-0.5 transition-colors',
            overridden
              ? 'cursor-pointer text-zinc-400 hover:text-blue-500'
              : 'cursor-default text-transparent'
          )}
        >
          <RotateCcw size={10} />
        </button>
      </div>
      <span
        className={cn(
          'caption-xs font-mono',
          overridden ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'
        )}
      >
        {displayValue}
      </span>
    </div>
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value) || fallback)}
      className="caption-xs w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 font-mono transition-colors outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
    />
    {hint && (
      <p className="caption-xs leading-relaxed text-amber-500 dark:text-amber-400">{hint}</p>
    )}
  </div>
);

/** Small header chip showing which model the user is currently editing. */
const PanelHeader = ({ modelName, label }: { modelName: string; label: string }) => (
  <div className="border-be border-sidebar-border mbe-2 py-2.5 ps-4 pe-4">
    <div className="caption-md font-bold text-zinc-400 uppercase">{label}</div>
    {modelName && (
      <div className="text-caption mbs-0.5 truncate text-zinc-500" title={modelName}>
        {modelName}
      </div>
    )}
  </div>
);

/**
 * Per-model sampling parameter panel. Bound to the currently selected model
 * via `useModelParamsStore` + `useModelContextWindow`. Each slider/input
 * shows the resolved value: user override if present, model metadata for
 * `numCtx` when available, otherwise `DEFAULT_MODEL_PARAMS`.
 *
 * A reset affordance (RotateCcw icon next to each label) clears the override
 * for that single param, snapping it back to its derived default.
 *
 * When `numCtx` is overridden to a value larger than the current model's
 * `context_length`, the slider display is clamped to `context_length`,
 * Ollama receives the clamped value, but the stored override is preserved —
 * switching back to a larger-context model restores the user's tuning.
 */

/**
 * Hook bundling the per-model params panel's reactive state: resolved params,
 * per-field override flags, and `setParam`/`resetParam` actions. Extracted to
 * keep `ModelParamsPanel` under the lint `max-lines-per-function` cap.
 */
function useModelParamsPanelState() {
  const selectedModel = useModelStore((s) => s.selectedModel);
  const { contextWindow, defaultParams } = useModelContextWindow();
  const resolved = useResolvedModelParams(selectedModel, contextWindow, defaultParams);

  return {
    selectedModel,
    contextWindow,
    ...resolved,
    setParam: useModelParamsStore((s) => s.setParam),
    resetParam: useModelParamsStore((s) => s.resetParam),
    tempOverridden: useIsParamOverridden(selectedModel, 'temperature'),
    topPOverridden: useIsParamOverridden(selectedModel, 'topP'),
    topKOverridden: useIsParamOverridden(selectedModel, 'topK'),
    numCtxOverridden: useIsParamOverridden(selectedModel, 'numCtx'),
    numPredictOverridden: useIsParamOverridden(selectedModel, 'numPredict'),
  };
}

/** Presentational body delegating the five slider/input groups. Extracted
 *  to keep `ModelParamsPanel` under the lint `max-lines-per-function` cap. */
interface ParamsBodyProps {
  selectedModel: string;
  temperature: number;
  topK: number;
  topP: number;
  numCtx: number;
  numPredict: number;
  numCtxMax: number;
  numCtxHint?: string;
  tempOverridden: boolean;
  topPOverridden: boolean;
  topKOverridden: boolean;
  numCtxOverridden: boolean;
  numPredictOverridden: boolean;
  setParam: (m: string, k: ModelParamKey, v: number) => void;
  resetParam: (m: string, k: ModelParamKey) => void;
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
  formatNumber: (n: number, opts?: Record<string, unknown>) => string;
}

const ParamsBody = ({
  selectedModel,
  temperature,
  topK,
  topP,
  numCtx,
  numPredict,
  numCtxMax,
  numCtxHint,
  tempOverridden,
  topPOverridden,
  topKOverridden,
  numCtxOverridden,
  numPredictOverridden,
  setParam,
  resetParam,
  t,
  formatNumber,
}: ParamsBodyProps) => (
  <>
    <div className="flex flex-col gap-2 px-4">
      <SliderControl
        label={t('settings.temperature')}
        value={temperature}
        min={VALIDATION_LIMITS.TEMPERATURE_RANGE[0]}
        max={1}
        step={0.1}
        displayValue={formatNumber(temperature, { minimumFractionDigits: 1 })}
        overridden={tempOverridden}
        onReset={() => resetParam(selectedModel, 'temperature')}
        onChange={(v) => setParam(selectedModel, 'temperature', v)}
      />
    </div>

    <div className="grid grid-cols-2 gap-4 px-4">
      <SliderControl
        label={t('settings.topP')}
        value={topP}
        min={VALIDATION_LIMITS.TOP_P_RANGE[0]}
        max={VALIDATION_LIMITS.TOP_P_RANGE[1]}
        step={0.1}
        displayValue={formatNumber(topP, { minimumFractionDigits: 1 })}
        overridden={topPOverridden}
        onReset={() => resetParam(selectedModel, 'topP')}
        onChange={(v) => setParam(selectedModel, 'topP', v)}
      />
      <SliderControl
        label={t('settings.topK')}
        value={topK}
        min={VALIDATION_LIMITS.TOP_K_RANGE[0]}
        max={VALIDATION_LIMITS.TOP_K_RANGE[1]}
        step={1}
        displayValue={formatNumber(topK)}
        overridden={topKOverridden}
        onReset={() => resetParam(selectedModel, 'topK')}
        onChange={(v) => setParam(selectedModel, 'topK', v)}
      />
    </div>

    <div className="pbs-1 grid grid-cols-2 gap-4 px-4">
      <NumberInput
        label={t('settings.contextWindow')}
        value={numCtx}
        displayValue={formatNumber(numCtx)}
        fallback={VALIDATION_LIMITS.NUM_CTX_RANGE[0]}
        min={VALIDATION_LIMITS.NUM_CTX_RANGE[0]}
        max={numCtxMax}
        overridden={numCtxOverridden}
        onReset={() => resetParam(selectedModel, 'numCtx')}
        onChange={(v) => setParam(selectedModel, 'numCtx', v)}
        hint={numCtxHint}
      />
      <NumberInput
        label={t('settings.maxTokens')}
        value={numPredict}
        displayValue={formatNumber(numPredict)}
        fallback={VALIDATION_LIMITS.NUM_PREDICT_RANGE[0]}
        min={VALIDATION_LIMITS.NUM_PREDICT_RANGE[0]}
        max={VALIDATION_LIMITS.NUM_PREDICT_RANGE[1]}
        overridden={numPredictOverridden}
        onReset={() => resetParam(selectedModel, 'numPredict')}
        onChange={(v) => setParam(selectedModel, 'numPredict', v)}
      />
    </div>

    <div className="caption-xs flex items-center gap-1.5 px-4 text-zinc-400">
      <SlidersHorizontal size={10} />
      <span>{t('library.paramsPerModelHint')}</span>
    </div>
  </>
);

const ModelParamsPanel = ({ className }: { className?: string }) => {
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t, formatNumber } = useTranslation(language);
  const {
    selectedModel,
    contextWindow,
    temperature,
    topK,
    topP,
    numCtx,
    numPredict,
    rawNumCtxOverride,
    numCtxClamped,
    setParam,
    resetParam,
    tempOverridden,
    topPOverridden,
    topKOverridden,
    numCtxOverridden,
    numPredictOverridden,
  } = useModelParamsPanelState();

  const numCtxMax = Math.min(
    contextWindow ?? VALIDATION_LIMITS.NUM_CTX_RANGE[1],
    VALIDATION_LIMITS.NUM_CTX_RANGE[1]
  );
  const numCtxHint =
    numCtxClamped && rawNumCtxOverride !== null
      ? t('library.numCtxAboveModelMax', {
          override: formatNumber(rawNumCtxOverride),
          max: formatNumber(contextWindow ?? 0),
        })
      : undefined;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <PanelHeader modelName={selectedModel} label={t('library.modelParameters')} />
      <ParamsBody
        selectedModel={selectedModel}
        temperature={temperature}
        topK={topK}
        topP={topP}
        numCtx={numCtx}
        numPredict={numPredict}
        numCtxMax={numCtxMax}
        numCtxHint={numCtxHint}
        tempOverridden={tempOverridden}
        topPOverridden={topPOverridden}
        topKOverridden={topKOverridden}
        numCtxOverridden={numCtxOverridden}
        numPredictOverridden={numPredictOverridden}
        setParam={setParam}
        resetParam={resetParam}
        t={t}
        formatNumber={formatNumber}
      />
    </div>
  );
};

export default ModelParamsPanel;
