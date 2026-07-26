'use client';

import React from 'react';
import { Trash2, Zap, ShieldCheck, Code, BrainCircuit, HardDrive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { type Language } from '@musaed/contracts';
import { useModelCapabilities } from '@/features/library/hooks/useModelCapabilities';

interface InstalledModelCardProps {
  name: string;
  size?: number | string | null;
  details?: {
    parameterSize?: string | null;
    quantizationLevel?: string | null;
    family?: string | null;
  };
  onDelete?: (name: string) => void;
  language: Language;
}

/**
 * Compact model card for installed models.
 */
const InstalledModelCard = ({
  name,
  size,
  details,
  onDelete,
  language,
}: InstalledModelCardProps) => {
  const { t, formatFileSize } = useTranslation(language);
  const { isCode, isReasoning, isHeavy } = useModelCapabilities(name, details);

  const displaySize = size ? (typeof size === 'string' ? size : formatFileSize(size)) : null;

  return (
    <div className="group flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 transition-all hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-800/50 dark:hover:border-zinc-700">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
          {isReasoning ? (
            <BrainCircuit size={18} />
          ) : isCode ? (
            <Code size={18} />
          ) : (
            <Zap size={18} />
          )}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold">{name}</h3>
            {details?.parameterSize && (
              <span
                className={cn(
                  'caption-xs rounded-sm px-1.5 py-0.5 font-black tracking-tighter uppercase',
                  isHeavy
                    ? 'bg-red-100 text-red-600 dark:bg-red-900/30'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'
                )}
              >
                {details.parameterSize}
              </span>
            )}
          </div>
          <div className="mbs-1 flex items-center gap-3">
            {displaySize && (
              <span className="caption-xs flex items-center gap-1 font-bold tracking-widest text-zinc-400 uppercase">
                <HardDrive size={10} />
                {displaySize}
              </span>
            )}
            {details?.quantizationLevel && (
              <span className="caption-xs font-mono text-zinc-400">
                {details.quantizationLevel}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="caption-xs flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 font-bold tracking-widest text-green-600 uppercase dark:bg-green-900/20 dark:text-green-400">
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

export default React.memo(InstalledModelCard);
