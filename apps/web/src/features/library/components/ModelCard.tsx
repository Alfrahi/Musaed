"use client";

import React from 'react';
import { CheckCircle2, Download, Loader2, Trash2, Zap, ShieldCheck } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useTranslation } from '../../../lib/i18n';
import { Language } from '@musaed/contracts';

interface ModelCardProps {
  name: string;
  description?: string;
  size?: number | string | null;
  isDownloaded: boolean;
  pullStatus?: { status: string; progress?: number };
  onPull?: (name: string) => void;
  onDelete?: (name: string) => void;
  language: Language;
  variant?: 'featured' | 'installed';
}

const ModelCard = ({ 
  name, 
  description, 
  size, 
  isDownloaded, 
  pullStatus, 
  onPull, 
  onDelete, 
  language,
  variant = 'featured'
}: ModelCardProps) => {
  const { t, formatNumber, formatFileSize } = useTranslation(language);

  const displaySize = size ? (typeof size === 'string' ? size : formatFileSize(size)) : null;

  if (variant === 'installed') {
    return (
      <div className="p-4 rounded-none bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between group hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-none flex items-center justify-center text-zinc-500">
            <Zap size={18} />
          </div>
          <div>
            <h3 className="font-bold text-sm">{name}</h3>
            {displaySize && (
              <div className="flex items-center gap-3 mbs-1">
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                  {displaySize}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-2 py-1 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-none text-[10px] font-bold uppercase tracking-widest flex items-center gap-1">
            <ShieldCheck size={12} />
            {t('common.ready')}
          </div>
          {onDelete && (
            <button 
              onClick={() => onDelete(name)}
              className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-none transition-all"
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div 
      className={cn(
        "group p-5 rounded-none border transition-all duration-300 flex flex-col justify-between",
        isDownloaded 
          ? "bg-blue-50/30 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30" 
          : "bg-white dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
      )}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-lg group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {name}
            </h3>
            {description && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mbs-1 leading-relaxed">
                {description}
              </p>
            )}
          </div>
          {isDownloaded && (
            <div className="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 p-1.5 rounded-none">
              <CheckCircle2 size={16} />
            </div>
          )}
        </div>
      </div>

      <div className="mbs-6">
        {pullStatus ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              <span className="flex items-center gap-2">
                {pullStatus.status === t('library.status.success') ? (
                  <CheckCircle2 size={12} className="text-green-500" />
                ) : (
                  <Loader2 size={12} className="animate-spin text-blue-500" />
                )}
                {pullStatus.status}
              </span>
              {pullStatus.progress !== undefined && <span className="font-mono">{formatNumber(pullStatus.progress)}%</span>}
            </div>
          </div>
        ) : (
          <button
            onClick={() => onPull?.(name)}
            disabled={isDownloaded}
            className={cn(
              "w-full py-2.5 rounded-none text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2",
              isDownloaded
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-default"
                : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 active:scale-[0.98]"
            )}
          >
            {isDownloaded ? t('library.installed', { count: 1 }) : (
              <>
                <Download size={14} className="mirror-rtl" />
                {t('library.pullModel')}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default React.memo(ModelCard);