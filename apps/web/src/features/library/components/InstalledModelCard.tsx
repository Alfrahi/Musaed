"use client";

import React from 'react';
import { Trash2, Zap, ShieldCheck, Code, BrainCircuit, HardDrive } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useTranslation } from '../../../lib/i18n';
import { Language } from '@musaed/contracts';
import { useModelCapabilities } from '../hooks/useModelCapabilities';

interface InstalledModelCardProps {
  name: string;
  size?: number | string | null;
  details?: {
    parameter_size?: string | null;
    quantization_level?: string | null;
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
    <div className="p-4 rounded-lg bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between group hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-500">
          {isReasoning ? <BrainCircuit size={18} /> : isCode ? <Code size={18} /> : <Zap size={18} />}
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

export default React.memo(InstalledModelCard);
