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
} from 'lucide-react';
import { type Message } from '@musaed/contracts';
import { cn } from '@/lib/utils';
import MessageContent from './MessageContent';
import { attachmentImageSrc } from '../image-attachment';
import { useMessageActions } from '@/features/conversation/hooks/useMessageActions';
import { MessageAvatar } from './MessageAvatar';
import { MessageStats } from './MessageStats';
import { useSettingsStore } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { useContextMenu } from '@/hooks/useContextMenu';
import { FileChunkViewer } from '@/features/rag';
import ModalLayout from '@/components/ui/ModalLayout';
import AttachmentLightbox from './AttachmentLightbox';
import { Button } from '@/components/ui/button';

/** Max number of citation chips rendered before an overflow "Show N more…"
 *  affordance kicks in. Keeps the assistant bubble scannable when a single
 *  answer cites many files. Audit F11 — UX-UI-AUDIT remediation Prompt 10. */
const SOURCE_OVERFLOW_CAP = 5;

interface MessageBubbleProps {
  message: Message;
  labels: {
    user: string;
    assistant: string;
    copy: string;
    tokens: string;
  };
  formatNumber: (num: number, options?: Intl.NumberFormatOptions) => string;
  /** Called when the user selects "Regenerate" from the context menu. */
  onRegenerate?: () => void;
  /** Called when the user clicks "Continue" on a stopped message. */
  onContinue?: () => void;
  /** Called when the user clicks "Edit prompt" — pulls the preceding user
   *  message back into the input for editing. */
  onEditPrompt?: () => void;
  /** Called when the user clicks "Edit" on their own message. */
  onEdit?: () => void;
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
      className="bg-secondary/50 hover:bg-secondary text-foreground inline-flex items-start gap-2 rounded-md p-2 text-start transition-colors"
    >
      <FileText className="text-muted-foreground mt-0.5 h-3 w-3 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {source.filePath}
          <span className="text-muted-foreground ms-1 font-normal">
            (lines {source.startLine}–{source.endLine})
          </span>
        </span>
        {source.language && (
          <span className="text-muted-foreground block text-xs">{source.language}</span>
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

/** Renders the RAG source references section. Citations are buttons (audit F11)
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
      <div className="mt-2 space-y-2 text-xs">
        {list.map((source, index) => (
          <CitationChip key={index} source={source} onOpen={onOpenSource} t={t} />
        ))}
        {hasOverflow && !showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-muted-foreground hover:text-foreground ms-2 text-xs font-medium underline-offset-2 hover:underline"
          >
            {t('a11y.showNMoreSources', { count: hiddenCount })}
          </button>
        )}
        {hasOverflow && showAll && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="text-muted-foreground hover:text-foreground ms-2 text-xs font-medium underline-offset-2 hover:underline"
          >
            {t('a11y.showFewerSources')}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="mt-4 border-t pt-4">
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs font-medium"
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
      <div className="border-sidebar-border flex items-center justify-between border-b px-4 py-3">
        <h2 id={titleId} className="truncate text-sm font-medium">
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
 * group-focus-within so keyboard users can reach them (Prompt 14).
 */
interface HoverActionsProps {
  isUser: boolean;
  isStopped: boolean;
  onRegenerate?: () => void;
  onContinue?: () => void;
  onEditPrompt?: () => void;
  onEdit?: () => void;
  t: (key: string) => string;
}

const HoverActions = ({
  isUser,
  isStopped,
  onRegenerate,
  onContinue,
  onEditPrompt,
  onEdit,
  t,
}: HoverActionsProps) => {
  const hasActions =
    (isUser && onEdit) || (!isUser && (onRegenerate || onContinue || onEditPrompt));
  if (!hasActions) return null;

  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
      {!isUser && onRegenerate && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onRegenerate}
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
          onClick={onContinue}
          aria-label={t('chat.continue')}
          title={t('chat.continue')}
        >
          <Play size={14} />
        </Button>
      )}
      {!isUser && onEditPrompt && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onEditPrompt}
          aria-label={t('chat.editPrompt')}
          title={t('chat.editPrompt')}
        >
          <Pencil size={14} />
        </Button>
      )}
      {isUser && onEdit && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onEdit}
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
 * Shows "Stopped by user • Continue" (Prompt 14).
 */
interface StoppedStatusLineProps {
  isStopped: boolean;
  onContinue?: () => void;
  t: (key: string) => string;
}

const StoppedStatusLine = ({ isStopped, onContinue, t }: StoppedStatusLineProps) => {
  if (!isStopped) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <span>{t('chat.stoppedByUser')}</span>
      <span>•</span>
      {onContinue && (
        <button
          type="button"
          onClick={onContinue}
          className="text-primary font-medium hover:underline"
        >
          {t('chat.continue')}
        </button>
      )}
    </div>
  );
};

/**
 * Context menu wiring for a message bubble. Extracted to keep MessageBubble
 * under the max-lines-per-function lint gate (Prompt 14).
 */
function useMessageContextMenu(
  handleCopy: () => void,
  onRegenerate: (() => void) | undefined,
  t: (key: string) => string
) {
  const { showContextMenu } = useContextMenu({ onCopy: handleCopy, onRegenerate });
  return useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      showContextMenu('message', e.clientX, e.clientY, {
        copy: t('contextMenu.message.copy'),
        regenerate: t('contextMenu.message.regenerate'),
      });
    },
    [showContextMenu, t]
  );
}

interface MessageHeaderProps {
  isUser: boolean;
  isStopped: boolean;
  labels: { user: string; assistant: string; copy: string };
  message: Message;
  copied: boolean;
  handleCopy: () => void;
  onRegenerate?: () => void;
  onContinue?: () => void;
  onEditPrompt?: () => void;
  onEdit?: () => void;
  t: (key: string) => string;
}

const MessageHeader = ({
  isUser,
  isStopped,
  labels,
  message,
  copied,
  handleCopy,
  onRegenerate,
  onContinue,
  onEditPrompt,
  onEdit,
  t,
}: MessageHeaderProps) => (
  <div className="flex items-center justify-between">
    <span className="caption-md font-bold text-zinc-400 uppercase">
      {isUser ? labels.user : labels.assistant}
      {!isUser && message.model && <span className="ms-3 text-zinc-500">{message.model}</span>}
    </span>
    <div className="flex items-center gap-1">
      <HoverActions
        isUser={isUser}
        isStopped={isStopped}
        onRegenerate={onRegenerate}
        onContinue={onContinue}
        onEditPrompt={onEditPrompt}
        onEdit={onEdit}
        t={t}
      />
      <button
        onClick={handleCopy}
        className="hover:text-foreground p-1 text-zinc-400 transition-colors"
        aria-label={labels.copy}
      >
        {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
      </button>
    </div>
  </div>
);

/**
 * Inline image gallery for user messages. Extracted to keep MessageBubble
 * under the max-lines-per-function lint gate.
 */
const MessageImages = ({
  images,
  onImageClick,
}: {
  images: string[];
  onImageClick: (img: string) => void;
}) => (
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
          alt=""
          width={384}
          height={256}
          unoptimized
          className="border-sidebar-border max-w-sm border shadow-sm"
        />
      </Button>
    ))}
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
  onEditPrompt,
  onEdit,
}: MessageBubbleProps) => {
  const isUser = message.role === 'user';
  const { copied, handleCopy, tps } = useMessageActions(message);
  const sourceReferences = (message.ragSources ?? []) as SourceReference[];
  const [isExpanded, setIsExpanded] = useState(sourceReferences.length > 0);
  const [openSource, setOpenSource] = useState<SourceReference | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const titleId = 'rag-source-title';
  const handleContextMenu = useMessageContextMenu(handleCopy, onRegenerate, t);
  const isStopped = message.stopped === true && message.role === 'assistant';

  return (
    <div
      onContextMenu={handleContextMenu}
      className={cn(
        'border-be border-sidebar-border w-full transition-colors',
        isUser ? 'bg-background' : 'bg-zinc-50 dark:bg-zinc-900/30'
      )}
    >
      <div className="group ms-auto me-auto flex max-w-4xl gap-6 py-8 ps-6 pe-6">
        <MessageAvatar isUser={isUser} />

        <div className="min-w-0 flex-1 space-y-4">
          <MessageHeader
            isUser={isUser}
            isStopped={isStopped}
            labels={labels}
            message={message}
            copied={copied}
            handleCopy={handleCopy}
            onRegenerate={onRegenerate}
            onContinue={onContinue}
            onEditPrompt={onEditPrompt}
            onEdit={onEdit}
            t={t}
          />

          {message.images && message.images.length > 0 && (
            <MessageImages images={message.images} onImageClick={setLightboxImage} />
          )}

          <div className="text-foreground selection:bg-primary/20 text-[14px] leading-relaxed antialiased">
            <MessageContent message={message} isUser={isUser} />
          </div>

          {sourceReferences.length > 0 && (
            <RagSourceReferences
              sources={sourceReferences}
              isExpanded={isExpanded}
              onToggleExpand={() => setIsExpanded(!isExpanded)}
              onOpenSource={(source) => setOpenSource(source)}
              t={t}
            />
          )}

          <MessageStats
            message={message}
            tps={tps}
            formatNumber={formatNumber}
            tokensLabel={labels.tokens}
          />

          <StoppedStatusLine isStopped={isStopped} onContinue={onContinue} t={t} />
        </div>
      </div>

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
    </div>
  );
};

export default React.memo(MessageBubble);
