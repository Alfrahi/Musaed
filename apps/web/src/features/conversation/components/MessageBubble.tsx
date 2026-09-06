'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { useMessageActions } from '../hooks/useMessageActions';
import { useMessageDelete } from '../hooks/useMessageDelete';
import { useMessageContextMenu } from '../hooks/useMessageContextMenu';
import { useMessageBubbleState } from '../hooks/useMessageBubbleState';
import AttachmentLightbox from './AttachmentLightbox';
import {
  MemoizedMessageBubbleBody,
  type MessageBubbleBodyProps,
} from './message/MessageBubbleBody';
import { SourceViewerModal } from './message/SourceViewerModal';
import type { MessageBubbleProps } from './message/types';

/**
 * Renders a single message bubble in the chat window.
 */
const MessageBubble = ({
  message,
  labels,
  formatNumber,
  onRegenerate,
  onContinue,
  onEditMessage,
  onDeleteMessage,
}: MessageBubbleProps) => {
  const isUser = message.role === 'user';
  const { handleCopy } = useMessageActions(message);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const titleId = 'rag-source-title';
  const handleDelete = useMessageDelete(message.id, onDeleteMessage, t);
  const handleContextMenu = useMessageContextMenu(
    handleCopy,
    message.id,
    onRegenerate,
    handleDelete,
    t
  );
  const shouldReduceMotion = useReducedMotion() ?? false;

  const bubbleClassName = cn(
    'border-be border-sidebar-border w-full transition-colors',
    isUser
      ? 'bg-blue-50/50 dark:bg-blue-950/20'
      : 'border-s-2 border-blue-500/30 bg-zinc-50 dark:bg-zinc-900/30'
  );

  const s = useMessageBubbleState(message, onEditMessage, onDeleteMessage);

  // Built inline (not `useMemo`'d): `MemoizedMessageBubbleBody` does a shallow
  // prop comparison, so a fresh wrapper with stable callback/primitive values
  // still skips re-render. The `useCallback`'d handlers are what keep the
  // comparison passing across content churn (React H4).
  const bodyProps: MessageBubbleBodyProps = {
    isUser: s.isUser,
    isStopped: s.isStopped,
    isEditing: s.isEditing,
    message,
    labels,
    sourceReferences: s.sourceReferences,
    isExpanded: s.isExpanded,
    onToggleExpand: s.onToggleExpand,
    onOpenSource: s.onOpenSource,
    onImageClick: s.onImageClick,
    tps: s.tps,
    formatNumber,
    copied: s.copied,
    handleCopy: s.handleCopy,
    onRegenerate,
    onContinue,
    onStartEdit: s.isUser && onEditMessage ? s.startEdit : undefined,
    onSaveEdit: s.saveEdit,
    onCancelEdit: s.cancelEdit,
    handleDelete: onDeleteMessage ? s.handleDelete : undefined,
    t: s.t,
  };

  const overlays = (
    <>
      {s.openSource && (
        <SourceViewerModal
          source={s.openSource}
          titleId={titleId}
          onClose={() => s.setOpenSource(null)}
          t={t}
        />
      )}
      {s.lightboxImage && (
        <AttachmentLightbox
          isOpen
          onClose={() => s.setLightboxImage(null)}
          imageSrc={s.lightboxImage}
        />
      )}
    </>
  );

  return shouldReduceMotion ? (
    <div onContextMenu={handleContextMenu} className={bubbleClassName}>
      <MemoizedMessageBubbleBody {...bodyProps} />
      {overlays}
    </div>
  ) : (
    <motion.div
      onContextMenu={handleContextMenu}
      className={bubbleClassName}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <MemoizedMessageBubbleBody {...bodyProps} />
      {overlays}
    </motion.div>
  );
};

export default React.memo(MessageBubble);
