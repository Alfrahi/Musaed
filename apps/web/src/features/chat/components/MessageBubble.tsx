"use client";

import React, { useState } from 'react';
import { User, Bot, Copy, Check, Zap, Cpu } from 'lucide-react';
import { motion } from 'framer-motion';
import { Message } from '@musaed/contracts';
import { cn } from '../../../lib/utils';
import MessageContent from './MessageContent';
import { useSettingsStore } from '../../../store';
import { useTranslation } from '../../../lib/i18n';

interface MessageBubbleProps {
  message: Message;
}

const MessageBubble = ({ message }: MessageBubbleProps) => {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const { globalSettings } = useSettingsStore();
  const { t, formatNumber } = useTranslation(globalSettings.language);

  const handleCopy = () => {
    const cleanContent = message.content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    navigator.clipboard.writeText(cleanContent || message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Prioritize eval_duration for accurate TPS (total_duration includes loading time)
  const durationNs = message.eval_duration || message.total_duration || 0;
  const tps = message.eval_count !== undefined && durationNs > 0
  ? (message.eval_count / (durationNs / 1e9))
  : 0;

  return (
    <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.2 }}
    className={cn(
      "group flex gap-5 w-full max-w-4xl ms-auto me-auto pbs-6 pbe-6 ps-6 pe-6 transition-all duration-300",
      !isUser && "bg-zinc-50/50 dark:bg-zinc-900/30 rounded-[2.5rem] border border-zinc-100/50 dark:border-zinc-800/30 mbs-4 mbe-4 shadow-sm"
    )}
    >
    <div
    className={cn(
      "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm transition-all group-hover:shadow-md",
      isUser
      ? "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
      : "bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-blue-500/20"
    )}
    >
    {isUser ? <User size={20} /> : <Bot size={20} />}
    </div>

    <div className="flex-1 space-y-3 overflow-hidden">
    <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
    {isUser ? t('chat.user') : t('chat.assistant')}
    </span>
    {!isUser && message.model && (
      <span className="ps-1.5 pe-1.5 pbs-0.5 pbe-0.5 bg-zinc-200/50 dark:bg-zinc-800/50 rounded text-[9px] font-bold text-zinc-500 tracking-wider">
      {message.model}
      </span>
    )}
    </div>
    {!isUser && message.content && (
      <button
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-xl text-zinc-500 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-blue-500"
      aria-label={t('common.copy')}
      >
      {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
      </button>
    )}
    </div>

    {message.images && message.images.length > 0 && (
      <div className="flex flex-wrap gap-3 mbe-4">
      {message.images.map((img, idx) => (
        <motion.div
        key={idx}
        whileHover={{ scale: 1.02 }}
        className="relative max-w-[320px] rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-md"
        >
        <img src={`data:image/png;base64,${img}`} alt={t('chat.userUploaded')} className="w-full h-auto" />
        </motion.div>
      ))}
      </div>
    )}

    <div className="text-sm md:text-base leading-relaxed text-zinc-800 dark:text-zinc-200">
    <MessageContent message={message} isUser={isUser} />
    </div>

    {/* Statistics bar - now shows even if eval_count is 0 */}
    {!isUser && message.eval_count !== undefined && (
      <div className="pbs-4 flex items-center gap-3 border-bs border-zinc-200/20 dark:border-zinc-800/30 mbs-4">
      <div className="flex items-center gap-1.5 ps-2.5 pe-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[9px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
      <Cpu size={12} />
      <span>{formatNumber(message.eval_count)} {t('chat.tokens')}</span>
      </div>

      {tps > 0 && (
        <div className="flex items-center gap-1.5 ps-2.5 pe-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest">
        <Zap size={12} className="text-blue-500" />
        <span>
        {t('chat.tokensPerSecond', {
          speed: formatNumber(tps, { maximumFractionDigits: 1 })
        })}
        </span>
        </div>
      )}
      </div>
    )}
    </div>
    </motion.div>
  );
};

export default React.memo(MessageBubble);
