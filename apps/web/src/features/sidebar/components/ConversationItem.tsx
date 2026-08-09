'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { MessageSquare, Trash2, Download, Edit2 } from 'lucide-react';
import { useCurrentConversationId, useSetCurrentConversationId } from '@/store/conversation-store';
import { useLanguage } from '@/store';
import { cn } from '@/lib/utils';
import { useSidebarActions } from '@/features/sidebar/hooks/useSidebarActions';
import { useTranslation } from '@/lib/i18n';
import { useContextMenu } from '@/hooks/useContextMenu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ConversationMetadata } from '@/store/conversation-store';

interface ConversationItemProps {
  conversation: ConversationMetadata;
}

/** Inline rename input for conversation title. */
const RenameInput = ({
  value,
  onChange,
  onBlur,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) => (
  <form
    onSubmit={onSubmit}
    className="flex min-w-0 flex-1 items-center"
    onBlur={(e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return;
      onBlur();
    }}
  >
    <Input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className="text-label border-primary w-full px-1 py-0.5"
    />
  </form>
);

/** Hover action buttons for a conversation item. */
const ItemActions = ({
  onEdit,
  onExport,
  onDelete,
  editTitle,
  exportTitle,
  deleteTitle,
}: {
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
  editTitle: string;
  exportTitle: string;
  deleteTitle: string;
}) => {
  // reason: action buttons live *inside* the row, which has its own onClick
  // activating the conversation. Without stopPropagation, clicking Edit /
  // Export / Delete would also bubble to the row and activate it — the
  // nested-interactive pitfall.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div
      className="absolute end-2 flex items-center gap-1 bg-inherit ps-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      onClick={stop}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={onEdit}
        className="hover:text-foreground h-auto min-h-6 w-auto min-w-6 p-1 hover:bg-zinc-300 dark:hover:bg-zinc-700"
        title={editTitle}
      >
        <Edit2 size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onExport}
        className="h-auto min-h-6 w-auto min-w-6 p-1 hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-900/20"
        title={exportTitle}
      >
        <Download size={14} className="mirror-rtl" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        className="h-auto min-h-6 w-auto min-w-6 p-1 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
        title={deleteTitle}
      >
        <Trash2 size={14} />
      </Button>
    </div>
  );
};

/**
 * Renders the conversation row's outer element, applying the framer-motion
 * entrance animation on the first mount only. Reduced-motion and already-
 * animated rows render as a plain div so react-virtuoso remounts (scroll-back
 * recycling) don't replay the entrance flicker.
 */
interface ConversationRowProps {
  shouldAnimate: boolean;
  rowRef: React.RefObject<HTMLDivElement | null>;
  isActive: boolean;
  conversationId: string;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}

const rowClassName = (isActive: boolean) =>
  cn(
    'group text-label focus-ring duration-fast relative flex cursor-pointer items-center gap-3 border-s-2 border-transparent px-4 py-2.5 transition-all',
    isActive
      ? 'border-primary text-foreground rounded-md bg-zinc-200/50 font-semibold dark:bg-zinc-800/50'
      : 'text-zinc-500 hover:border-zinc-300 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/50'
  );

const ConversationRow = ({
  shouldAnimate,
  rowRef,
  isActive,
  conversationId,
  onClick,
  onKeyDown,
  onContextMenu,
  children,
}: ConversationRowProps) => {
  const sharedProps = {
    ref: rowRef,
    role: 'option' as const,
    'aria-current': isActive ? ('page' as const) : undefined,
    'aria-selected': isActive || undefined,
    tabIndex: isActive ? 0 : -1,
    id: `conversation-option-${conversationId}`,
    onClick,
    onKeyDown,
    onContextMenu,
    className: rowClassName(isActive),
  };

  if (shouldAnimate) {
    return (
      <motion.div
        {...sharedProps}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    );
  }

  return <div {...sharedProps}>{children}</div>;
};

const ConversationItem = ({ conversation }: ConversationItemProps) => {
  const currentConversationId = useCurrentConversationId();
  const setCurrentConversationId = useSetCurrentConversationId();
  const language = useLanguage();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const { handleDeleteConversation, handleRenameConversation, handleExport } = useSidebarActions();
  const shouldReduceMotion = useReducedMotion() ?? false;
  // react-virtuoso recycles rows when scrolling back into view — a row that
  // scrolled out and back in remounts, which would replay the enter animation
  // as a visible flicker. Only animate the very first mount of this instance;
  // virtualization-driven remounts render as a plain div (initial/animate
  // omitted) so they snap into place with no motion.
  const hasAnimatedRef = useRef(false);
  const { showContextMenu } = useContextMenu({
    onRename: () => {
      setEditingId(conversation.id);
      setEditTitle(conversation.title);
    },
    onExport: () => handleExport(conversation),
    onDelete: () => handleDeleteConversation(conversation.id),
  });
  const { t } = useTranslation(language);
  const rowRef = useRef<HTMLDivElement>(null);

  const isActive = currentConversationId === conversation.id;

  // Roving tabindex + programmatic focus: when a *different* conversation
  // becomes active, that row receives `tabIndex=0` and is programmatically
  // focused so keyboard users land on it directly when Tabbing into the
  // listbox. Manual focus management, not `aria-activedescendant`, because the
  // parent listbox is `react-virtuoso` virtualized (out-of-viewport options
  // are unmounted and their DOM ids disappear, violating `aria-activedescendant`).
  //
  // We only programmatically focus on a `false → true` transition of
  // `isActive`. The row that is active on initial mount (or after a Virtuoso
  // remount while it stays active) is NOT focused programmatically: browsers
  // classify a programmatic `.focus()` with no prior user interaction as
  // `:focus-visible`, which would flash the focus ring on the first
  // conversation before the user touches the keyboard.
  const prevActiveRef = useRef<boolean>(isActive);
  useEffect(() => {
    if (isActive && !prevActiveRef.current && rowRef.current && editingId !== conversation.id) {
      rowRef.current.focus();
    }
    prevActiveRef.current = isActive;
  }, [isActive, editingId, conversation.id]);

  const handleSubmitRename = (e: React.FormEvent) => {
    e.preventDefault();
    handleRenameConversation(conversation.id, editTitle);
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // The listbox owns arrow-key navigation, but Enter and Space activate the
    // row under it (inline rename input handles its own Enter via the form
    // `onSubmit` handler — we skip Enter while editing to avoid a double-fire).
    if (editingId === conversation.id) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setCurrentConversationId(conversation.id);
    }
  };

  const handleContextMenu = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      showContextMenu('conversation', e.clientX, e.clientY, {
        rename: t('contextMenu.conversation.rename'),
        export: t('contextMenu.conversation.export'),
        delete: t('contextMenu.conversation.delete'),
      });
    },
    [showContextMenu, t]
  );

  // Animate only the first mount of this instance — once a row has played
  // its enter animation we render as a plain motion.div (no `initial`), so
  // react-virtuoso recycling the row on scroll-back snaps it into place
  // without a replay flicker.
  const shouldAnimate = !shouldReduceMotion && !hasAnimatedRef.current;
  if (shouldAnimate) hasAnimatedRef.current = true;

  return (
    <ConversationRow
      shouldAnimate={shouldAnimate}
      rowRef={rowRef}
      isActive={isActive}
      conversationId={conversation.id}
      onClick={() => setCurrentConversationId(conversation.id)}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
    >
      <MessageSquare
        size={14}
        className={cn('shrink-0', isActive ? 'text-primary' : 'text-zinc-400')}
      />

      {editingId === conversation.id ? (
        <RenameInput
          value={editTitle}
          onChange={setEditTitle}
          onBlur={() => {
            handleRenameConversation(conversation.id, editTitle);
            setEditingId(null);
          }}
          onSubmit={handleSubmitRename}
        />
      ) : (
        <span className="flex-1 truncate py-0.5 pe-14 tracking-tight">{conversation.title}</span>
      )}

      <ItemActions
        onEdit={() => {
          setEditingId(conversation.id);
          setEditTitle(conversation.title);
        }}
        onExport={() => handleExport(conversation)}
        onDelete={() => handleDeleteConversation(conversation.id)}
        editTitle={t('sidebar.renameChat')}
        exportTitle={t('sidebar.exportMarkdown')}
        deleteTitle={t('sidebar.deleteChat')}
      />
    </ConversationRow>
  );
};

export default ConversationItem;
