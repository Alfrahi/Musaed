"use client";

import { useState } from 'react';
import { MessageSquare, Trash2, Download, Edit2 } from 'lucide-react';
import { Conversation } from '@musaed/contracts';
import { useCurrentConversationId, useSetCurrentConversationId, useLanguage } from '../../../store/hooks';
import { cn } from '../../../lib/utils';
import { useSidebarActions } from '../hooks/useSidebarActions';
import { useTranslation } from '../../../lib/i18n';

interface ConversationItemProps {
  conversation: Conversation;
}

/** Inline rename input for conversation title. */
const RenameInput = ({
  value, onChange, onBlur, onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) => (
  <form onSubmit={onSubmit} className="flex-1 min-w-0 flex items-center">
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className="w-full bg-white dark:bg-zinc-900 border border-primary px-1 py-0.5 text-[13px] outline-none rounded-none"
    />
  </form>
);

/** Hover action buttons for a conversation item. */
const ItemActions = ({
  onEdit, onExport, onDelete, editTitle, exportTitle, deleteTitle,
}: {
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
  editTitle: string;
  exportTitle: string;
  deleteTitle: string;
}) => (
  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute end-2 bg-inherit ps-2">
    <button onClick={onEdit} className="p-1 hover:text-foreground hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors" title={editTitle}>
      <Edit2 size={12} />
    </button>
    <button onClick={onExport} className="p-1 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title={exportTitle}>
      <Download size={12} className="mirror-rtl" />
    </button>
    <button onClick={onDelete} className="p-1 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title={deleteTitle}>
      <Trash2 size={12} />
    </button>
  </div>
);

const ConversationItem = ({ conversation }: ConversationItemProps) => {
  const currentConversationId = useCurrentConversationId();
  const setCurrentConversationId = useSetCurrentConversationId();
  const language = useLanguage();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const { handleDeleteConversation, handleRenameConversation, handleExport } = useSidebarActions();
  const { t } = useTranslation(language);

  const isActive = currentConversationId === conversation.id;

  const handleSubmitRename = (e: React.FormEvent) => {
    e.preventDefault();
    handleRenameConversation(conversation.id, editTitle);
    setEditingId(null);
  };

  return (
    <div
      onClick={() => setCurrentConversationId(conversation.id)}
      className={cn(
        "group flex items-center gap-2.5 px-3 py-2 cursor-pointer text-[13px] border-s-2 transition-all relative",
        isActive
          ? "bg-zinc-200/50 dark:bg-zinc-800/50 border-primary text-foreground font-semibold"
          : "border-transparent text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/30"
      )}
    >
      <MessageSquare size={14} className={cn("shrink-0", isActive ? "text-primary" : "text-zinc-400")} />

      {editingId === conversation.id ? (
        <RenameInput
          value={editTitle}
          onChange={setEditTitle}
          onBlur={() => setEditingId(null)}
          onSubmit={handleSubmitRename}
        />
      ) : (
        <span className="truncate flex-1 py-0.5 tracking-tight">{conversation.title}</span>
      )}

      <ItemActions
        onEdit={() => { setEditingId(conversation.id); setEditTitle(conversation.title); }}
        onExport={() => handleExport(conversation)}
        onDelete={() => handleDeleteConversation(conversation.id)}
        editTitle={t('sidebar.renameChat')}
        exportTitle={t('sidebar.exportMarkdown')}
        deleteTitle={t('sidebar.deleteChat')}
      />
    </div>
  );
};

export default ConversationItem;
