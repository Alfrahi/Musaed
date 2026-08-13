'use client';

import React, { useState, useCallback } from 'react';
import Image from 'next/image';
import {
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  X,
  RefreshCw,
  Play,
  Pencil,
  Trash2,
  Cpu,
  Zap,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { type Message } from '@musaed/contracts';
import { cn } from '@/lib/utils';
import MessageContent from './MessageContent';
import { attachmentImageSrc } from '../image-attachment';
import { useMessageActions } from '@/features/conversation/hooks/useMessageActions';
import { MessageAvatar } from './MessageAvatar';
import { useSettingsStore } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { useContextMenu } from '@/hooks/useContextMenu';
import { FileChunkViewer } from '@/features/rag';
import ModalLayout from '@/components/ui/ModalLayout';
import AttachmentLightbox from './AttachmentLightbox';
import { Button } from '@/components/ui/button';
import { dialogApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';

/** Max number of citation chips rendered before an overflow "Show N more…"
 *  affordance kicks in. Keeps the assistant bubble scannable when a single
 *  answer cites many files. */
const SOURCE_OVERFLOW_CAP = 5;

interface MessageBubbleProps {
  message: Message;
  labels: {
    user: string;
    assistant: string;
    copy: string;
    tokens: string;
    outputTokens: string;
    promptTokens: string;
    totalTokens: string;
  };
  formatNumber: (num: number, options?: Intl.NumberFormatOptions) => string;
  /** Called when the user selects "Regenerate" from the context menu.
   *  Receives the assistant message id so the caller can keep a stable
   *  callback reference (React.memo defeat). */
  onRegenerate?: (msgId: string) => void;
  /** Called when the user clicks "Continue" on a stopped message. */
  onContinue?: (msgId: string) => void;
  /** Called when the user saves an inline edit on their own message.
   *  Receives the message id and the new content. The parent is
   *  responsible for updating the store and re-sending. */
  onEditMessage?: (msgId: string, newContent: string) => void;
  /** Called when the user confirms deletion of a message.
   *  Receives the message id. The parent is responsible for
   *  removing the message from the store and backend. */
  onDeleteMessage?: (msgId: string) => void;
}

interface SourceReference {
  filePath: string;
  startLine: number;
  endLine: number;
  language?: string;
}

interface CitationChipProps {
  source: SourceReference;
  onOpen: (source: SourceReference) => void;
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
}

/** A single citation rendered as a button — clicking mounts the
 *  `FileChunkViewer` modal pre-scrolled to the cited line range. */
const CitationChip = ({ source, onOpen, t }: CitationChipProps) => {
  const ariaLabel = t('a11y.openSource', {
    file: source.filePath,
    startLine: source.startLine,
    endLine: source.endLine,
  });
  return (
    <button
      type="button"
      onClick={() => onOpen(source)}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="bg-secondary/50 hover:bg-secondary text-foreground inline-flex cursor-pointer items-start gap-2 rounded-md p-2 text-start transition-colors"
    >
      <FileText className="text-muted-foreground mbs-0.5 h-3 w-3 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {source.filePath}
          <span className="text-muted-foreground ms-1 font-normal">
            (lines {source.startLine}–{source.endLine})
          </span>
        </span>
        {source.language && (
          <span className="text-muted-foreground text-caption block">{source.language}</span>
        )}
      </span>
    </button>
  );
};

interface RagSourceReferencesProps {
  sources: SourceReference[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenSource: (source: SourceReference) => void;
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
}

/** Renders the RAG source references section. Citations are buttons
 *  and the section is expanded by default when sources are present so the
 *  grounding is visible without an extra interaction. */
const RagSourceReferences = ({
  sources,
  isExpanded,
  onToggleExpand,
  onOpenSource,
  t,
}: RagSourceReferencesProps) => {
  const visibleSources = isExpanded ? sources.slice(0, SOURCE_OVERFLOW_CAP) : [];
  const hiddenCount = sources.length - SOURCE_OVERFLOW_CAP;
  const hasOverflow = hiddenCount > 0;
  const [showAll, setShowAll] = useState(false);

  const renderCitations = () => {
    if (!isExpanded) return null;
    const list = showAll ? sources : visibleSources;
    return (
      <div className="text-caption mbs-2 space-y-2">
        {list.map((source, index) => (
          <CitationChip key={index} source={source} onOpen={onOpenSource} t={t} />
        ))}
        {hasOverflow && !showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-muted-foreground hover:text-foreground text-caption ms-2 cursor-pointer font-medium underline-offset-2 hover:underline"
          >
            {t('a11y.showNMoreSources', { count: hiddenCount })}
          </button>
        )}
        {hasOverflow && showAll && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="text-muted-foreground hover:text-foreground text-caption ms-2 cursor-pointer font-medium underline-offset-2 hover:underline"
          >
            {t('a11y.showFewerSources')}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="mbs-4 border-bs pbs-4">
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground text-caption flex cursor-pointer items-center gap-2 font-medium"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
      >
        <FileText className="h-3 w-3" />
        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {t('rag.sourceReferenceCount', { count: sources.length })}
      </button>
      {renderCitations()}
    </div>
  );
};

/**
 * Modal hosting the `FileChunkViewer` for a citation chip. Extracted out of
 * the `MessageBubble` body so the bubble component stays under the project's
 * `max-lines-per-function` lint gate (STANDARDS §11) — the citation modal
 * block is logically self-contained (header + close affordance + viewer).
 */
interface SourceViewerModalProps {
  source: SourceReference;
  titleId: string;
  onClose: () => void;
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
}

const SourceViewerModal = ({ source, titleId, onClose, t }: SourceViewerModalProps) => (
  <ModalLayout isOpen onClose={onClose} titleId={titleId} maxWidth="max-w-3xl" className="h-[80vh]">
    <div className="flex h-full flex-col">
      <div className="border-sidebar-border border-be flex items-center justify-between px-4 py-3">
        <h2 id={titleId} className="text-body truncate font-medium">
          {source.filePath}:{source.startLine}–{source.endLine}
        </h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('a11y.closeModal')}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-hidden">
        <FileChunkViewer filePath={source.filePath} targetStartLine={source.startLine} />
      </div>
    </div>
  </ModalLayout>
);

/**
 * Hover action buttons for message bubbles — discoverable via
 * group-focus-within so keyboard users can reach them.
 */
interface HoverActionsProps {
  isUser: boolean;
  isStopped: boolean;
  msgId: string;
  onRegenerate?: (msgId: string) => void;
  onContinue?: (msgId: string) => void;
  onStartEdit?: () => void;
  t: (key: string) => string;
}

const HoverActions = ({
  isUser,
  isStopped,
  msgId,
  onRegenerate,
  onContinue,
  onStartEdit,
  t,
}: HoverActionsProps) => {
  const hasActions = (isUser && onStartEdit) || (!isUser && (onRegenerate || onContinue));
  if (!hasActions) return null;

  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
      {!isUser && onRegenerate && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onRegenerate(msgId)}
          aria-label={t('chat.regenerate')}
          title={t('chat.regenerate')}
        >
          <RefreshCw size={14} />
        </Button>
      )}
      {!isUser && isStopped && onContinue && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onContinue(msgId)}
          aria-label={t('chat.continue')}
          title={t('chat.continue')}
        >
          <Play size={14} />
        </Button>
      )}
      {isUser && onStartEdit && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onStartEdit}
          aria-label={t('chat.editPrompt')}
          title={t('chat.editPrompt')}
        >
          <Pencil size={14} />
        </Button>
      )}
    </div>
  );
};

/**
 * Inline status line rendered below a stopped assistant message.
 * Shows "Stopped by user • Continue".
 */
interface StoppedStatusLineProps {
  isStopped: boolean;
  msgId: string;
  onContinue?: (msgId: string) => void;
  t: (key: string) => string;
}

const StoppedStatusLine = ({ isStopped, msgId, onContinue, t }: StoppedStatusLineProps) => {
  if (!isStopped) return null;
  return (
    <div className="text-caption flex items-center gap-2 text-zinc-500">
      <span>{t('chat.stoppedByUser')}</span>
      <span>•</span>
      {onContinue && (
        <button
          type="button"
          onClick={() => onContinue(msgId)}
          className="text-primary cursor-pointer font-medium hover:underline"
        >
          {t('chat.continue')}
        </button>
      )}
    </div>
  );
};

/**
 * Context menu wiring for a message bubble. Extracted to keep MessageBubble
 * under the max-lines-per-function lint gate.
 */
function useMessageContextMenu(
  handleCopy: () => void,
  msgId: string,
  onRegenerate: ((msgId: string) => void) | undefined,
  onDelete: (() => void) | undefined,
  t: (key: string) => string
) {
  const { showContextMenu } = useContextMenu({
    onCopy: handleCopy,
    onRegenerate: onRegenerate ? () => onRegenerate(msgId) : undefined,
    onDelete,
  });
  return useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      showContextMenu('message', e.clientX, e.clientY, {
        copy: t('contextMenu.message.copy'),
        regenerate: t('contextMenu.message.regenerate'),
        delete: t('contextMenu.message.delete'),
      });
    },
    [showContextMenu, t]
  );
}

interface MessageHeaderProps {
  isUser: boolean;
  message: Message;
  labels: { user: string; assistant: string };
}

const MessageHeader = ({ isUser, message, labels }: MessageHeaderProps) => (
  <div className="flex items-center">
    <span className="caption-md font-bold text-zinc-400 uppercase">
      {isUser ? labels.user : labels.assistant}
      {!isUser && message.model && <span className="ms-3 text-zinc-500">{message.model}</span>}
    </span>
  </div>
);

interface MessageFooterProps {
  isUser: boolean;
  isStopped: boolean;
  msgId: string;
  labels: {
    copy: string;
    tokens: string;
    outputTokens: string;
    promptTokens: string;
    totalTokens: string;
  };
  message: Message;
  tps: number;
  formatNumber: (num: number, options?: Intl.NumberFormatOptions) => string;
  copied: boolean;
  handleCopy: () => void;
  onRegenerate?: (msgId: string) => void;
  onContinue?: (msgId: string) => void;
  onStartEdit?: () => void;
  handleDelete?: (() => void) | undefined;
  t: (key: string) => string;
}

const MessageFooter = ({
  isUser,
  isStopped,
  msgId,
  labels,
  message,
  tps,
  formatNumber,
  copied,
  handleCopy,
  onRegenerate,
  onContinue,
  onStartEdit,
  handleDelete,
  t,
}: MessageFooterProps) => {
  const evalCount = message.evalCount;
  const promptTokens = message.promptTokens ?? message.promptEvalCount ?? null;
  const completionTokens = message.completionTokens ?? evalCount ?? null;
  const hasStats = !isUser && evalCount != null;

  return (
    <div className="pbs-4 border-bs border-sidebar-border/50 flex items-center gap-4">
      {hasStats && evalCount != null && (
        <div className="caption-xs flex items-center gap-4 font-bold text-zinc-400">
          {promptTokens != null && (
            <span className="flex items-center gap-1.5">
              <Cpu size={12} />
              {formatNumber(promptTokens)}
              {labels.promptTokens}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Cpu size={12} />
            {formatNumber(evalCount)}
            {labels.outputTokens}
          </span>
          {promptTokens != null && completionTokens != null && (
            <span className="flex items-center gap-1.5">
              <Cpu size={12} />
              {formatNumber(promptTokens + completionTokens)}
              {labels.totalTokens}
            </span>
          )}
          {tps > 0 && (
            <span className="text-primary flex items-center gap-1.5">
              <Zap size={12} />
              {formatNumber(tps, { maximumFractionDigits: 1 })} T/S
            </span>
          )}
        </div>
      )}

      <div className="ms-auto flex items-center gap-1">
        <HoverActions
          isUser={isUser}
          isStopped={isStopped}
          msgId={msgId}
          onRegenerate={onRegenerate}
          onContinue={onContinue}
          onStartEdit={onStartEdit}
          t={t}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCopy}
          className="hover:text-foreground cursor-pointer p-1 text-zinc-400"
          aria-label={labels.copy}
        >
          {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
        </Button>
        {handleDelete && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            className="hover:text-foreground cursor-pointer p-1 text-zinc-400"
            aria-label={t('common.delete')}
            title={t('common.delete')}
          >
            <Trash2 size={14} />
          </Button>
        )}
      </div>
    </div>
  );
};

/**
 * Inline image gallery for user messages. Extracted to keep MessageBubble
 * under the max-lines-per-function lint gate.
 */
const MessageImages = ({
  images,
  onImageClick,
  t,
}: {
  images: string[];
  onImageClick: (img: string) => void;
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
}) => {
  const total = images.length;
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((img, idx) => (
        <Button
          key={idx}
          variant="ghost"
          size="icon"
          onClick={() => onImageClick(img)}
          className="h-auto w-auto cursor-zoom-in p-0"
        >
          <Image
            src={attachmentImageSrc(img)}
            alt={
              total > 1
                ? t('chat.userUploadedImageIndexed', { index: idx + 1, total })
                : t('chat.userUploadedImage')
            }
            width={384}
            height={256}
            unoptimized
            className="border-sidebar-border shadow-native max-w-sm border"
          />
        </Button>
      ))}
    </div>
  );
};

/**
 * Inline editor for user messages — replaces the message content with a
 * textarea and Save/Cancel buttons when the user clicks Edit.
 */
interface InlineEditorProps {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
  t: (key: string) => string;
}

const InlineEditor = ({ initialContent, onSave, onCancel, t }: InlineEditorProps) => {
  const [draft, setDraft] = useState(initialContent);

  return (
    <div className="space-y-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="border-sidebar-border focus-ring text-foreground text-body w-full resize-none rounded-md border p-3 leading-relaxed outline-none"
        rows={3}
        autoFocus
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onSave(draft.trim());
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => onSave(draft.trim())} disabled={!draft.trim()}>
          {t('common.save')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
};

/**
 * Inline editor state for a message bubble — toggled on by the Edit button.
 * Extracted to keep MessageBubble under the max-lines-per-function lint gate.
 */
function useInlineEdit(msgId: string, onEditMessage?: (msgId: string, newContent: string) => void) {
  const [isEditing, setIsEditing] = useState(false);

  const startEdit = useCallback(() => setIsEditing(true), []);
  const cancelEdit = useCallback(() => setIsEditing(false), []);
  const saveEdit = useCallback(
    (newContent: string) => {
      setIsEditing(false);
      onEditMessage?.(msgId, newContent);
    },
    [msgId, onEditMessage]
  );

  return { isEditing, startEdit, cancelEdit, saveEdit };
}

/**
 * Delete handler with native confirmation dialog. Shows a blocking
 * `dialogApi.ask` (rfd OkCancel) before calling the parent's
 * `onDeleteMessage` callback.
 */
function useMessageDelete(
  msgId: string,
  onDeleteMessage: ((msgId: string) => void) | undefined,
  t: (key: string) => string
) {
  return useCallback(async () => {
    if (!onDeleteMessage) return;
    const confirmed = await dialogApi.ask(
      t('chat.deleteMessage'),
      t('chat.confirmDeleteMessage'),
      'warning'
    );
    if (confirmed) {
      logger.info('Deleting message', { msgId });
      onDeleteMessage(msgId);
    }
  }, [msgId, onDeleteMessage, t]);
}

/** Props for the inner message body (avatar + content + footer). */
interface MessageBubbleBodyProps {
  isUser: boolean;
  isStopped: boolean;
  isEditing: boolean;
  message: Message;
  labels: {
    user: string;
    assistant: string;
    copy: string;
    tokens: string;
    outputTokens: string;
    promptTokens: string;
    totalTokens: string;
  };
  sourceReferences: SourceReference[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenSource: (source: SourceReference) => void;
  onImageClick: (img: string) => void;
  tps: number;
  formatNumber: (num: number, options?: Intl.NumberFormatOptions) => string;
  copied: boolean;
  handleCopy: () => void;
  onRegenerate?: (msgId: string) => void;
  onContinue?: (msgId: string) => void;
  onStartEdit?: () => void;
  onSaveEdit: (newContent: string) => void;
  onCancelEdit: () => void;
  handleDelete: (() => void) | undefined;
  t: (key: string, values?: Record<string, string | number | boolean>) => string;
}

/** Inner layout: avatar + content + footer. Extracted to keep
 *  MessageBubble under the max-lines-per-function lint gate. */
const MessageBubbleBody = ({
  isUser,
  isStopped,
  isEditing,
  message,
  labels,
  sourceReferences,
  isExpanded,
  onToggleExpand,
  onOpenSource,
  onImageClick,
  tps,
  formatNumber,
  copied,
  handleCopy,
  onRegenerate,
  onContinue,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  handleDelete,
  t,
}: MessageBubbleBodyProps) => (
  <div className="group ms-auto me-auto flex max-w-4xl gap-6 py-6 ps-5 pe-5 max-md:gap-4 max-md:ps-3 max-md:pe-3">
    <MessageAvatar isUser={isUser} />
    <div className="min-w-0 flex-1 space-y-4">
      <MessageHeader isUser={isUser} message={message} labels={labels} />
      {message.images && message.images.length > 0 && (
        <MessageImages images={message.images} onImageClick={onImageClick} t={t} />
      )}
      {isEditing ? (
        <InlineEditor
          initialContent={message.content}
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
          t={t}
        />
      ) : (
        <div className="text-foreground selection:bg-primary/20 text-body leading-relaxed antialiased">
          <MessageContent message={message} isUser={isUser} />
        </div>
      )}
      {sourceReferences.length > 0 && !isEditing && (
        <RagSourceReferences
          sources={sourceReferences}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          onOpenSource={onOpenSource}
          t={t}
        />
      )}
      <StoppedStatusLine isStopped={isStopped} msgId={message.id} onContinue={onContinue} t={t} />
      <MessageFooter
        isUser={isUser}
        isStopped={isStopped}
        msgId={message.id}
        labels={labels}
        message={message}
        tps={tps}
        formatNumber={formatNumber}
        copied={copied}
        handleCopy={handleCopy}
        onRegenerate={onRegenerate}
        onContinue={onContinue}
        onStartEdit={onStartEdit}
        handleDelete={handleDelete}
        t={t}
      />
    </div>
  </div>
);

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
  const { copied, handleCopy, tps } = useMessageActions(message);
  const sourceReferences = (message.ragSources ?? []) as SourceReference[];
  const [isExpanded, setIsExpanded] = useState(sourceReferences.length > 0);
  const [openSource, setOpenSource] = useState<SourceReference | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const { isEditing, startEdit, cancelEdit, saveEdit } = useInlineEdit(message.id, onEditMessage);
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
  const isStopped = message.stopped === true && message.role === 'assistant';
  const shouldReduceMotion = useReducedMotion() ?? false;

  const bubbleClassName = cn(
    'border-be border-sidebar-border w-full transition-colors',
    isUser
      ? 'bg-blue-50/50 dark:bg-blue-950/20'
      : 'border-s-2 border-blue-500/30 bg-zinc-50 dark:bg-zinc-900/30'
  );

  const bodyProps = {
    isUser,
    isStopped,
    isEditing,
    message,
    labels,
    sourceReferences,
    isExpanded,
    onToggleExpand: () => setIsExpanded(!isExpanded),
    onOpenSource: (source: SourceReference) => setOpenSource(source),
    onImageClick: setLightboxImage,
    tps,
    formatNumber,
    copied,
    handleCopy,
    onRegenerate,
    onContinue,
    onStartEdit: isUser && onEditMessage ? startEdit : undefined,
    onSaveEdit: saveEdit,
    onCancelEdit: cancelEdit,
    handleDelete: onDeleteMessage ? handleDelete : undefined,
    t,
  };

  const overlays = (
    <>
      {openSource && (
        <SourceViewerModal
          source={openSource}
          titleId={titleId}
          onClose={() => setOpenSource(null)}
          t={t}
        />
      )}
      {lightboxImage && (
        <AttachmentLightbox
          isOpen
          onClose={() => setLightboxImage(null)}
          imageSrc={lightboxImage}
        />
      )}
    </>
  );

  return shouldReduceMotion ? (
    <div onContextMenu={handleContextMenu} className={bubbleClassName}>
      <MessageBubbleBody {...bodyProps} />
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
      <MessageBubbleBody {...bodyProps} />
      {overlays}
    </motion.div>
  );
};

export default React.memo(MessageBubble);
