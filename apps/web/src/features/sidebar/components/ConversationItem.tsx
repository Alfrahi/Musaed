"use client";

import { useState } from 'react';
import { MessageSquare, Trash2, Download, Edit2, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Conversation } from '@musaed/contracts';
import { useConversationStore, useSettingsStore } from '../../../store';
import { cn } from '../../../lib/utils';
import { useSidebarActions } from '../hooks/useSidebarActions';
import { useTranslation } from '../../../lib/i18n';

interface ConversationItemProps {
  conversation: Conversation;
}

const ConversationItem = ({ conversation }: ConversationItemProps) => {
  const { currentConversationId, setCurrentConversationId } = useConversationStore();
  const { globalSettings } = useSettingsStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const { handleDeleteConversation, handleRenameConversation, handleExport } = useSidebarActions();
  const { t, isRtl } = useTranslation(globalSettings.language);

  const isActive = currentConversationId === conversation.id;
  const displayTitle = conversation.title === 'New Chat' ? t('sidebar.newChat') : conversation.title;

  const handleSubmitRename = (e: React.FormEvent) => {
    e.preventDefault();
    handleRenameConversation(conversation.id, editTitle);
    setEditingId(null);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: isRtl ? 10 : -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      role="listitem"
      className={cn(
        "group relative flex items-center gap-3 ps-3 pe-3 py-2.5 rounded-xl text-sm transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        isActive 
          ? "bg-white dark:bg-zinc-800 text-foreground shadow-native" 
          : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/40"
      )}
      onClick={() => setCurrentConversationId(conversation.id)}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && setCurrentConversationId(conversation.id)}
      aria-selected={isActive}
    >
      <div className="relative flex items-center justify-center">
        <MessageSquare size={16} className={cn("shrink-0 transition-colors", isActive ? "text-primary" : "text-zinc-400")} aria-hidden="true" />
      </div>
      
      {editingId === conversation.id ? (
        <form onSubmit={handleSubmitRename} className="flex-1 min-w-0 flex items-center gap-1">
          <input 
            autoFocus 
            value={editTitle} 
            onChange={(e) => setEditTitle(e.target.value)} 
            onBlur={() => setEditingId(null)}
            className="w-full bg-zinc-100 dark:bg-zinc-700 border-none rounded ps-1 pe-1 py-0.5 text-sm outline-none focus:ring-1 focus:ring-primary" 
            aria-label={t('sidebar.renameChat')}
          />
          <button type="submit" className="text-green-500 hover:text-green-600 outline-none focus-visible:ring-1 focus-visible:ring-green-500 rounded p-0.5">
            <Check size={14} aria-hidden="true" />
          </button>
        </form>
      ) : (
        <span className="truncate text-start flex-1 font-medium">{displayTitle}</span>
      )}

      <AnimatePresence>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
          <button 
            onClick={(e) => { e.stopPropagation(); setEditingId(conversation.id); setEditTitle(conversation.title); }} 
            className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-primary"
            aria-label={t('sidebar.renameChat')}
          >
            <Edit2 size={13} aria-hidden="true" />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); handleExport(conversation); }} 
            className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-primary"
            aria-label={t('sidebar.exportMarkdown')}
          >
            <Download size={13} className="mirror-rtl" aria-hidden="true" />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conversation.id); }} 
            className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-400 hover:text-red-600 rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-red-500"
            aria-label={t('sidebar.deleteChat')}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      </AnimatePresence>
    </motion.div>
  );
};

export default ConversationItem;