'use client';

import React from 'react';
import {
  CheckCircle2,
  Download,
  Loader2,
  Trash2,
  Zap,
  ShieldCheck,
  Eye,
  Code,
  BrainCircuit,
  HardDrive,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useTranslation } from '../../../lib/i18n';
import { type Language } from '@musaed/contracts';

interface ModelCardProps {
  name: string;
  description?: string;
  size?: number | string | null;
  details?: {
    parameter_size?: string | null;
    quantization_level?: string | null;
    family?: string | null;
  };
  isDownloaded: boolean;
  pullStatus?: { status: string; progress?: number };
  onPull?: (name: string) => void;
  onDelete?: (name: string) => void;
  language: Language;
  variant?: 'featured' | 'installed';
}

/** Detect model capabilities from its name. */
const getModelCapabilities = (name: string) => {
  const lower = name.toLowerCase();
  return {
    isVision: lower.includes('llava') || lower.includes('vision'),
    isCode: lower.includes('code') || lower.includes('coder'),
    isReasoning: lower.includes('r1') || lower.includes('reasoner'),
  };
};

/** Detect hardware requirements from parameter size. */
const getHardwareFit = (paramSize: string | null | undefined) => {
  const lower = paramSize?.toLowerCase() || '';
  return {
    isHeavy: lower.includes('70b') || lower.includes('110b') || lower.includes('405b'),
    isLight: lower.includes('1b') || lower.includes('3b') || lower.includes('8b'),
  };
};

/** Compact row variant for the installed models list. */
const InstalledModelCard = ({
  name,
  details,
  displaySize,
  onDelete,
  language,
}: {
  name: string;
  displaySize: string | null;
  details?: ModelCardProps['details'];
  isReasoning: boolean;
  isCode: boolean;
  onDelete?: (name: string) => void;
  language: Language;
}) => {
  const { t } = useTranslation(language);
  const { isHeavy } = getHardwareFit(details?.parameter_size);

  return (
    <div className="group flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 transition-all hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-800/50 dark:hover:border-zinc-700">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
          <Zap size={18} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold">{name}</h3>
            {details?.parameter_size && (
              <span
                className={cn(
                  'rounded-sm px-1.5 py-0.5 text-[9px] font-black tracking-tighter uppercase',
                  isHeavy
                    ? 'bg-red-100 text-red-600 dark:bg-red-900/30'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'
                )}
              >
                {details.parameter_size}
              </span>
            )}
          </div>
          <InstalledModelMeta displaySize={displaySize} details={details} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-[10px] font-bold tracking-widest text-green-600 uppercase dark:bg-green-900/20 dark:text-green-400">
          <ShieldCheck size={12} />
          {t('common.ready')}
        </div>
        {onDelete && (
          <button
            onClick={() => onDelete(name)}
            className="rounded-lg p-2 text-zinc-400 transition-all hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
          >
            <Trash2 size={18} />
          </button>
        )}
      </div>
    </div>
  );
};

/** Size and quantization badges for installed row. */
const InstalledModelMeta = ({
  displaySize,
  details,
}: {
  displaySize: string | null;
  details?: ModelCardProps['details'];
}) => (
  <div className="mbs-1 flex items-center gap-3">
    {displaySize && (
      <span className="flex items-center gap-1 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
        <HardDrive size={10} />
        {displaySize}
      </span>
    )}
    {details?.quantization_level && (
      <span className="font-mono text-[10px] text-zinc-400">{details.quantization_level}</span>
    )}
  </div>
);

/** Capability badges (Vision, Code, Reasoning). */
const CapabilityBadges = ({
  isVision,
  isCode,
  isReasoning,
  t,
}: ReturnType<typeof getModelCapabilities> & { t: (k: string) => string }) => (
  <div className="flex gap-1">
    {isVision && (
      <span title={t('library.visionCapable')}>
        <Eye size={14} className="text-purple-500" />
      </span>
    )}
    {isCode && (
      <span title={t('library.codingSpecialized')}>
        <Code size={14} className="text-blue-500" />
      </span>
    )}
    {isReasoning && (
      <span title={t('library.reasoningModel')}>
        <BrainCircuit size={14} className="text-amber-500" />
      </span>
    )}
  </div>
);

/** Hardware fit badge (Fast / High Resource). */
const HardwareBadge = ({
  isLight,
  isHeavy,
  t,
}: ReturnType<typeof getHardwareFit> & { t: (k: string) => string }) => {
  if (isLight) {
    return (
      <span className="rounded-sm bg-green-100 px-1.5 py-0.5 text-[9px] font-black tracking-tighter text-green-600 uppercase dark:bg-green-900/20">
        {t('library.fastLowVram')}
      </span>
    );
  }
  if (isHeavy) {
    return (
      <span className="rounded-sm bg-orange-100 px-1.5 py-0.5 text-[9px] font-black tracking-tighter text-orange-600 uppercase dark:bg-orange-900/20">
        {t('library.highResource')}
      </span>
    );
  }
  return null;
};

/** Download progress bar or pull button. */
const PullControl = ({
  name,
  isDownloaded,
  pullStatus,
  onPull,
  language,
}: {
  name: string;
  isDownloaded: boolean;
  pullStatus?: { status: string; progress?: number };
  onPull?: (name: string) => void;
  language: Language;
}) => {
  const { t, formatNumber } = useTranslation(language);

  if (pullStatus) {
    return <PullProgressBar pullStatus={pullStatus} formatNumber={formatNumber} />;
  }

  return (
    <button
      onClick={() => onPull?.(name)}
      disabled={isDownloaded}
      className={cn(
        'flex h-10 w-full items-center justify-center gap-2 rounded-lg text-[10px] font-bold tracking-widest uppercase shadow-sm transition-all',
        isDownloaded
          ? 'cursor-default bg-zinc-100 text-zinc-400 dark:bg-zinc-800'
          : 'bg-zinc-900 text-white hover:opacity-90 active:scale-95 dark:bg-zinc-100 dark:text-zinc-900'
      )}
    >
      {isDownloaded ? (
        t('library.installed', { count: 1 })
      ) : (
        <>
          <Download size={14} className="mirror-rtl" />
          {t('library.pullModel')}
        </>
      )}
    </button>
  );
};

/** Progress bar during model pull. */
const PullProgressBar = ({
  pullStatus,
  formatNumber,
}: {
  pullStatus: { status: string; progress?: number };
  formatNumber: (n: number) => string;
}) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
      <span className="flex items-center gap-2">
        {pullStatus.status.toLowerCase().includes('success') ? (
          <CheckCircle2 size={12} className="text-green-500" />
        ) : (
          <Loader2 size={12} className="animate-spin text-blue-500" />
        )}
        {pullStatus.status}
      </span>
      {pullStatus.progress !== undefined && (
        <span className="font-mono">{formatNumber(pullStatus.progress)}%</span>
      )}
    </div>
    {pullStatus.progress !== undefined && (
      <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${pullStatus.progress}%` }}
        />
      </div>
    )}
  </div>
);

/** Featured card variant for the model library grid. */
const FeaturedModelCard = ({
  name,
  description,
  isDownloaded,
  pullStatus,
  onPull,
  language,
  capabilities,
  hardwareFit,
}: {
  name: string;
  description?: string;
  isDownloaded: boolean;
  pullStatus?: { status: string; progress?: number };
  onPull?: (name: string) => void;
  language: Language;
  capabilities: ReturnType<typeof getModelCapabilities>;
  hardwareFit: ReturnType<typeof getHardwareFit>;
}) => {
  const { t } = useTranslation(language);
  return (
    <div
      className={cn(
        'group flex h-full flex-col justify-between rounded-lg border p-5 transition-all duration-300',
        isDownloaded
          ? 'border-blue-100 bg-blue-50/30 dark:border-blue-900/30 dark:bg-blue-900/10'
          : 'border-zinc-200 bg-white shadow-sm hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-800/50 dark:hover:border-zinc-700'
      )}
    >
      <FeaturedModelHeader
        name={name}
        description={description}
        isDownloaded={isDownloaded}
        capabilities={capabilities}
        t={t}
      />
      <div className="mbs-6">
        <div className="mbe-4 flex items-center gap-2">
          <HardwareBadge {...hardwareFit} t={t} />
        </div>
        <PullControl
          name={name}
          isDownloaded={isDownloaded}
          pullStatus={pullStatus}
          onPull={onPull}
          language={language}
        />
      </div>
    </div>
  );
};

/** Header section of the featured card: name, badges, description. */
const FeaturedModelHeader = ({
  name,
  description,
  isDownloaded,
  capabilities,
  t,
}: {
  name: string;
  description?: string;
  isDownloaded: boolean;
  capabilities: ReturnType<typeof getModelCapabilities>;
  t: (k: string) => string;
}) => (
  <div className="space-y-3">
    <div className="flex items-start justify-between">
      <div className="min-w-0">
        <div className="mbe-1 flex flex-wrap items-center gap-2">
          <h3 className="truncate text-lg font-bold transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {name}
          </h3>
          <CapabilityBadges {...capabilities} t={t} />
        </div>
        {description && (
          <p className="mbs-1 line-clamp-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {description}
          </p>
        )}
      </div>
      {isDownloaded && (
        <div className="shrink-0 rounded-lg bg-green-100 p-1.5 text-green-600 dark:bg-green-900/30 dark:text-green-400">
          <CheckCircle2 size={16} />
        </div>
      )}
    </div>
  </div>
);

/** Main ModelCard — delegates to installed or featured variant. */
const ModelCard = ({
  name,
  description,
  size,
  details,
  isDownloaded,
  pullStatus,
  onPull,
  onDelete,
  language,
  variant = 'featured',
}: ModelCardProps) => {
  const { formatFileSize } = useTranslation(language);

  const displaySize = size ? (typeof size === 'string' ? size : formatFileSize(size)) : null;
  const capabilities = getModelCapabilities(name);
  const hardwareFit = getHardwareFit(details?.parameter_size);

  if (variant === 'installed') {
    return (
      <InstalledModelCard
        name={name}
        displaySize={displaySize}
        details={details}
        isReasoning={capabilities.isReasoning}
        isCode={capabilities.isCode}
        onDelete={onDelete}
        language={language}
      />
    );
  }

  return (
    <FeaturedModelCard
      name={name}
      description={description}
      isDownloaded={isDownloaded}
      pullStatus={pullStatus}
      onPull={onPull}
      language={language}
      capabilities={capabilities}
      hardwareFit={hardwareFit}
    />
  );
};

export default React.memo(ModelCard);
