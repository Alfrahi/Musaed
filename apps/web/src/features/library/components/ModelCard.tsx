"use client";

import React from 'react';
import { CheckCircle2, Download, Loader2, Trash2, Zap, ShieldCheck, Eye, Code, BrainCircuit, HardDrive } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useTranslation } from '../../../lib/i18n';
import { Language } from '@musaed/contracts';

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
  name, details, displaySize, onDelete, language,
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
    <div className="p-4 rounded-lg bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between group hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-500">
          <Zap size={18} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm">{name}</h3>
            {details?.parameter_size && (
              <span className={cn(
                "px-1.5 py-0.5 text-[9px] font-black rounded-sm uppercase tracking-tighter",
                isHeavy ? "bg-red-100 dark:bg-red-900/30 text-red-600" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
              )}>
                {details.parameter_size}
              </span>
            )}
          </div>
          <InstalledModelMeta displaySize={displaySize} details={details} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="px-2 py-1 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-md text-[10px] font-bold uppercase tracking-widest flex items-center gap-1">
          <ShieldCheck size={12} />
          {t('common.ready')}
        </div>
        {onDelete && (
          <button
            onClick={() => onDelete(name)}
            className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
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
  displaySize, details,
}: {
  displaySize: string | null;
  details?: ModelCardProps['details'];
}) => (
  <div className="flex items-center gap-3 mbs-1">
    {displaySize && (
      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1">
        <HardDrive size={10} />
        {displaySize}
      </span>
    )}
    {details?.quantization_level && (
      <span className="text-[10px] font-mono text-zinc-400">
        {details.quantization_level}
      </span>
    )}
  </div>
);

/** Capability badges (Vision, Code, Reasoning). */
const CapabilityBadges = ({ isVision, isCode, isReasoning }: ReturnType<typeof getModelCapabilities>) => (
  <div className="flex gap-1">
    {isVision && (
      <span title="Vision Capable"><Eye size={14} className="text-purple-500" /></span>
    )}
    {isCode && (
      <span title="Coding Specialized"><Code size={14} className="text-blue-500" /></span>
    )}
    {isReasoning && (
      <span title="Reasoning Model"><BrainCircuit size={14} className="text-amber-500" /></span>
    )}
  </div>
);

/** Hardware fit badge (Fast / High Resource). */
const HardwareBadge = ({ isLight, isHeavy }: ReturnType<typeof getHardwareFit>) => {
  if (isLight) {
    return (
      <span className="text-[9px] font-black px-1.5 py-0.5 bg-green-100 dark:bg-green-900/20 text-green-600 rounded-sm uppercase tracking-tighter">
        Fast / Low VRAM
      </span>
    );
  }
  if (isHeavy) {
    return (
      <span className="text-[9px] font-black px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/20 text-orange-600 rounded-sm uppercase tracking-tighter">
        High Resource
      </span>
    );
  }
  return null;
};

/** Download progress bar or pull button. */
const PullControl = ({
  name, isDownloaded, pullStatus, onPull, language,
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
        "w-full h-10 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-sm",
        isDownloaded
          ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-default"
          : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 active:scale-95 hover:opacity-90"
      )}
    >
      {isDownloaded ? t('library.installed', { count: 1 }) : (
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
  pullStatus, formatNumber,
}: {
  pullStatus: { status: string; progress?: number };
  formatNumber: (n: number) => string;
}) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
      <span className="flex items-center gap-2">
        {pullStatus.status.toLowerCase().includes('success') ? (
          <CheckCircle2 size={12} className="text-green-500" />
        ) : (
          <Loader2 size={12} className="animate-spin text-blue-500" />
        )}
        {pullStatus.status}
      </span>
      {pullStatus.progress !== undefined && <span className="font-mono">{formatNumber(pullStatus.progress)}%</span>}
    </div>
    {pullStatus.progress !== undefined && (
      <div className="w-full h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
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
  name, description, isDownloaded, pullStatus, onPull, language, capabilities, hardwareFit,
}: {
  name: string;
  description?: string;
  isDownloaded: boolean;
  pullStatus?: { status: string; progress?: number };
  onPull?: (name: string) => void;
  language: Language;
  capabilities: ReturnType<typeof getModelCapabilities>;
  hardwareFit: ReturnType<typeof getHardwareFit>;
}) => (
  <div
    className={cn(
      "group p-5 rounded-lg border transition-all duration-300 flex flex-col justify-between h-full",
      isDownloaded
        ? "bg-blue-50/30 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30"
        : "bg-white dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 shadow-sm"
    )}
  >
    <FeaturedModelHeader name={name} description={description} isDownloaded={isDownloaded} capabilities={capabilities} />
    <div className="mbs-6">
      <div className="flex items-center gap-2 mbe-4">
        <HardwareBadge {...hardwareFit} />
      </div>
      <PullControl name={name} isDownloaded={isDownloaded} pullStatus={pullStatus} onPull={onPull} language={language} />
    </div>
  </div>
);

/** Header section of the featured card: name, badges, description. */
const FeaturedModelHeader = ({
  name, description, isDownloaded, capabilities,
}: {
  name: string;
  description?: string;
  isDownloaded: boolean;
  capabilities: ReturnType<typeof getModelCapabilities>;
}) => (
  <div className="space-y-3">
    <div className="flex items-start justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap mbe-1">
          <h3 className="font-bold text-lg group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
            {name}
          </h3>
          <CapabilityBadges {...capabilities} />
        </div>
        {description && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mbs-1 leading-relaxed line-clamp-2">
            {description}
          </p>
        )}
      </div>
      {isDownloaded && (
        <div className="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 p-1.5 rounded-lg shrink-0">
          <CheckCircle2 size={16} />
        </div>
      )}
    </div>
  </div>
);

/** Main ModelCard — delegates to installed or featured variant. */
const ModelCard = ({
  name, description, size, details, isDownloaded, pullStatus, onPull, onDelete, language, variant = 'featured',
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
